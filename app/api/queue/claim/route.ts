import { TicketStatus, UserRole, WorkerAvailability } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sortTicketsForCall } from "@/lib/queue-order";
import { presenceCutoff } from "@/lib/presence";

const activeStatuses = [TicketStatus.CALLED, TicketStatus.IN_SERVICE];
const MAX_PENDING_CALLS = 2;

export async function POST(request: Request) {
  try {
    const allowMultiple = new URL(request.url).searchParams.get("multiple") === "1";
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER);
    if (!user.branchId) return Response.json({ error: "No tienes una sede asignada." }, { status: 400 });
    const branchId = user.branchId;

    const result = await prisma.$transaction(async (tx) => {
      // Serialize calls by branch so only one advisor can claim each next ticket.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${branchId})::text`;

      const requester = await tx.user.findUnique({
        where: { id: user.id },
        select: { active: true, branchId: true, moduleNumber: true, availability: true, lastActiveAt: true },
      });
      if (!requester?.active || requester.branchId !== branchId || requester.moduleNumber === null) {
        return { ineligible: true } as const;
      }
      if (requester.availability !== WorkerAvailability.AVAILABLE) return { paused: true } as const;
      if (!requester.lastActiveAt || requester.lastActiveAt < presenceCutoff()) return { disconnected: true } as const;

      const activeTicket = await tx.ticket.findFirst({
        where: { assignedToId: user.id, status: TicketStatus.CALLED },
        select: { id: true },
      });
      if (!allowMultiple && activeTicket) return { active: true } as const;
      if (allowMultiple) {
        const pendingCalls = await tx.ticket.count({ where: { assignedToId: user.id, status: TicketStatus.CALLED } });
        if (pendingCalls >= MAX_PENDING_CALLS) return { pendingLimit: true } as const;
      }

      const waiting = await tx.ticket.findMany({
        where: { branchId, status: TicketStatus.WAITING },
        select: { id: true, arrivedAt: true, isPreferential: true },
      });
      const ticket = sortTicketsForCall(waiting)[0];
      if (!ticket) return null;

      const claimed = await tx.ticket.updateMany({
        where: { id: ticket.id, branchId, status: TicketStatus.WAITING },
        data: { status: TicketStatus.CALLED, assignedToId: user.id },
      });
      if (!claimed.count) return null;

      await tx.ticketHistory.create({ data: { ticketId: ticket.id, status: TicketStatus.CALLED, actorId: user.id } });
      const fullTicket = await tx.ticket.findUnique({
        where: { id: ticket.id },
        include: { service: true, branch: true, operations: { include: { bank: true } } },
      });
      return { ticket: fullTicket, assignedTo: { id: user.id, name: user.name } };
    }, { isolationLevel: "ReadCommitted" });

    if (!result) return Response.json({ error: "No hay turnos en espera." }, { status: 404 });
    if ("ineligible" in result) return Response.json({ error: "Tu usuario no está habilitado para llamar turnos en esta sede." }, { status: 403 });
    if ("paused" in result) return Response.json({ error: "Estás en pausa. Marca Disponible para poder llamar turnos." }, { status: 409 });
    if ("disconnected" in result) return Response.json({ error: "Tu sesión quedó desconectada. Actualiza la página para volver a llamar turnos." }, { status: 409 });
    if ("active" in result) return Response.json({ error: "Confirma primero si el cliente llamado se acercó antes de llamar otro ticket." }, { status: 409 });
    if ("pendingLimit" in result) return Response.json({ error: `Ya tienes ${MAX_PENDING_CALLS} clientes esperando confirmación. Confirma uno para llamar a otro.` }, { status: 409 });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
