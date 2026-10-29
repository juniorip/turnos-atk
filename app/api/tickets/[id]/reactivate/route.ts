import { TicketStatus, UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER, UserRole.ADMIN);
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Ticket inválido." }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const accessScope = user.role === UserRole.WORKER
        ? { assignedToId: user.id, branchId: user.branchId ?? -1 }
        : user.role === UserRole.MANAGER ? { branchId: user.branchId ?? -1 } : {};
      const ticket = await tx.ticket.findFirst({
        where: { id, ...accessScope, status: { in: [TicketStatus.COMPLETED, TicketStatus.FAILED, TicketStatus.CANCELLED] } },
        select: { id: true, branchId: true, status: true },
      });
      if (!ticket) return null;

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${ticket.branchId})::text`;
      const now = new Date();
      const reopened = await tx.ticket.updateMany({
        where: { id, ...accessScope, branchId: ticket.branchId, status: ticket.status },
        data: { status: TicketStatus.IN_SERVICE, startedAt: now, completedAt: null },
      });
      if (!reopened.count) return null;

      await tx.ticketHistory.create({ data: { ticketId: id, status: TicketStatus.IN_SERVICE, actorId: user.id, at: now } });
      return tx.ticket.findUniqueOrThrow({ where: { id }, include: { service: true } });
    }, { isolationLevel: "ReadCommitted" });

    if (!result) return Response.json({ error: "El ticket cambió de estado o está fuera de tu ámbito de acceso." }, { status: 409 });
    return Response.json({ ticket: result });
  } catch (error) {
    return errorResponse(error);
  }
}
