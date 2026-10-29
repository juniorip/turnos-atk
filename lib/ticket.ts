import { Prisma, TicketStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { ensureTicketDistrictSchema } from "./ticket-district-schema";
export const ticketPrefix = (serviceName: string) => ({ Registro: "REG", Consulta: "CON", Efectivización: "EFEC", "Pago de deuda": "PDEU", "Plan de retención": "PLAN" }[serviceName] || "ATK");

export function businessDayRange(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const start = new Date(`${date}T00:00:00-05:00`);
  return { start, end: new Date(start.getTime() + 86400000) };
}

// Call under the branch lock, within the transaction that inserts the ticket.
export async function nextTicketCode(tx: Prisma.TransactionClient, prefix: string, branchId: number) {
  const { start, end } = businessDayRange();
  const previous = await tx.ticket.findMany({ where: { branchId, createdAt: { gte: start, lt: end }, code: { startsWith: `${prefix}-` } }, select: { code: true } });
  const maximum = previous.reduce((max, ticket) => {
    const suffix = ticket.code.slice(prefix.length + 1);
    return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
  }, 0);
  return `${prefix}-${String(maximum + 1).padStart(3, "0")}`;
}

export async function createTicket(data: {
  branchId: number; serviceId: number; dni: string; documentType: "DNI" | "CE";
  clientName: string; district: string; isPreferential: boolean; createdById?: number; phone?: string; notes?: string;
}) {
  await ensureTicketDistrictSchema();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${data.branchId})::text`;
    const [branch, service] = await Promise.all([
      tx.branch.findFirst({ where: { id: data.branchId, active: true }, select: { id: true } }),
      tx.service.findFirst({ where: { id: data.serviceId, active: true }, select: { name: true } }),
    ]);
    if (!branch || !service) throw new Error("CATALOG_UNAVAILABLE");
    const code = await nextTicketCode(tx, ticketPrefix(service.name), data.branchId);
    return tx.ticket.create({ data: { ...data, code, history: { create: { status: TicketStatus.WAITING, actorId: data.createdById } } }, include: { service: true, branch: true } });
  }, { isolationLevel: "ReadCommitted" });
}
