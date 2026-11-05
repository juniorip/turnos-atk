import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lookupPancakeCustomerByDni, type PancakeDniLookupResult } from "@/lib/pancake";

type TicketIdentity = { id: number; dni: string };
export type TicketPancakeState = { state: "pending" } | { state: "ready"; result: PancakeDniLookupResult; checkedAt: string | null };

export async function readTicketPancake(ticket: TicketIdentity): Promise<TicketPancakeState> {
  const row = await prisma.ticketPancakeSnapshot.findUnique({ where: { ticketId: ticket.id } });
  if (!row || row.dni !== ticket.dni || !row.result || row.expiresAt <= new Date()) return { state: "pending" };
  return { state: "ready", result: row.result as PancakeDniLookupResult, checkedAt: row.checkedAt?.toISOString() || null };
}

export async function fillTicketPancake(ticket: TicketIdentity, refresh = false) {
  const now = new Date();
  await prisma.ticketPancakeSnapshot.upsert({ where: { ticketId: ticket.id }, create: { ticketId: ticket.id, dni: ticket.dni, expiresAt: new Date(0) }, update: {} });
  const claimKey = randomUUID();
  const claimed = await prisma.ticketPancakeSnapshot.updateMany({
    where: { ticketId: ticket.id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
      ...(!refresh ? { AND: [{ OR: [{ expiresAt: { lte: now } }, { dni: { not: ticket.dni } }] }] } : {}),
    },
    data: { claimKey, dni: ticket.dni, expiresAt: now, leaseUntil: new Date(now.getTime() + 55000) },
  });
  if (!claimed.count) return;
  const result = await lookupPancakeCustomerByDni(ticket.dni, { signal: AbortSignal.timeout(45000) });
  const checkedAt = new Date();
  const ttl = !result.ok ? 30000 : result.found ? 15 * 60000 : 2 * 60000;
  await prisma.ticketPancakeSnapshot.updateMany({
    where: { ticketId: ticket.id, dni: ticket.dni, claimKey },
    data: { result: result as unknown as Prisma.InputJsonValue, checkedAt, expiresAt: new Date(checkedAt.getTime() + ttl), leaseUntil: null, claimKey: null },
  });
}

export async function warmWaitingPancake(tickets: TicketIdentity[]) {
  if (!tickets.length) return;
  const now = new Date();
  const rows = await prisma.ticketPancakeSnapshot.findMany({ where: { ticketId: { in: tickets.map(ticket => ticket.id) } } });
  const byId = new Map(rows.map(row => [row.ticketId, row]));
  const pending = tickets.filter(ticket => {
    const row = byId.get(ticket.id);
    return !row || ((!row.leaseUntil || row.leaseUntil <= now) && (row.dni !== ticket.dni || row.expiresAt <= now));
  }).slice(0, 2);
  await Promise.allSettled(pending.map(ticket => fillTicketPancake(ticket)));
}
