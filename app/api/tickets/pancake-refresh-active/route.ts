import { Prisma, TicketStatus, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lookupPancakeCustomersByDni } from "@/lib/pancake-batch";
import { readTicketPancake } from "@/lib/ticket-pancake";

export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const user = await requireUser(UserRole.ADMIN, UserRole.WORKER, UserRole.MANAGER);
    const body = await request.json().catch(() => null);
    const ids = Array.isArray(body?.ticketIds)
      ? [...new Set(body.ticketIds.filter((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0))].slice(0, 5) as number[]
      : [];
    if (!ids.length) return Response.json({ tickets: [] }, { headers: { "Cache-Control": "no-store" } });

    const tickets = await prisma.ticket.findMany({
      where: {
        id: { in: ids },
        status: { in: [TicketStatus.CALLED, TicketStatus.IN_SERVICE] },
        ...(user.role === UserRole.ADMIN ? {} : { branchId: user.branchId ?? -1, assignedToId: user.id }),
      },
      select: { id: true, dni: true },
    });
    if (!tickets.length) return Response.json({ tickets: [] }, { headers: { "Cache-Control": "no-store" } });

    const now = new Date();
    const existingRows = await prisma.ticketPancakeSnapshot.findMany({ where: { ticketId: { in: tickets.map((ticket) => ticket.id) } } });
    const existingById = new Map(existingRows.map((row) => [row.ticketId, row]));
    const ticketsToSearch = tickets.filter((ticket) => {
      const row = existingById.get(ticket.id);
      if (!row || row.dni !== ticket.dni || !row.result || row.expiresAt <= now) return true;
      const result = row.result as { ok?: boolean; found?: boolean } | null;
      // A confirmed match stays cached; only unresolved/error results need a minute retry.
      return !(result?.ok && result.found);
    });
    await Promise.all(tickets.map((ticket) => prisma.ticketPancakeSnapshot.upsert({
      where: { ticketId: ticket.id },
      create: { ticketId: ticket.id, dni: ticket.dni, expiresAt: new Date(0) },
      update: { dni: ticket.dni },
    })));
    const claimKey = randomUUID();
    const claimed = ticketsToSearch.length ? await prisma.ticketPancakeSnapshot.updateMany({
      where: { ticketId: { in: ticketsToSearch.map((ticket) => ticket.id) }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      data: { claimKey, expiresAt: now, leaseUntil: new Date(now.getTime() + 55000) },
    }) : { count: 0 };
    const claimedRows = claimed.count
      ? await prisma.ticketPancakeSnapshot.findMany({ where: { ticketId: { in: tickets.map((ticket) => ticket.id) }, claimKey } })
      : [];
    if (claimedRows.length) {
      const batch = await lookupPancakeCustomersByDni(claimedRows.map((row) => row.dni), AbortSignal.timeout(45000));
      const checkedAt = new Date();
      await Promise.all(claimedRows.map((row) => {
        const result = batch.get(row.dni.replace(/\D/g, "")) || { ok: false as const, reason: "unavailable" as const };
        const ttl = !result.ok ? 30000 : result.found ? 15 * 60000 : 60000;
        return prisma.ticketPancakeSnapshot.updateMany({
          where: { ticketId: row.ticketId, claimKey, dni: row.dni },
          data: { result: result as unknown as Prisma.InputJsonValue, checkedAt, expiresAt: new Date(checkedAt.getTime() + ttl), leaseUntil: null, claimKey: null },
        });
      }));
    }

    const snapshots = await Promise.all(tickets.map(async (ticket) => ({
      ticketId: ticket.id,
      ...(await readTicketPancake(ticket)),
    })));
    // Keep the response limited to the exact active tickets the authenticated user may view.
    return Response.json({ tickets: snapshots }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
