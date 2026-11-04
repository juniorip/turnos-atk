import { TicketStatus, UserRole, WorkerAvailability } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { presenceCutoff } from "@/lib/presence";
import { prisma } from "@/lib/prisma";

const MAX_ACTIVE_TICKETS = 2;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(UserRole.MANAGER);
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return Response.json({ error: "Ticket inválido." }, { status: 400 });
    }
    if (!user.branchId) {
      return Response.json({ error: "No tienes una sede asignada." }, { status: 403 });
    }

    const branchId = user.branchId;
    const result = await prisma.$transaction(async (tx) => {
      // Keep direct assignments serialized with regular calls for this branch.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${branchId})::text`;

      const manager = await tx.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          name: true,
          role: true,
          active: true,
          branchId: true,
          moduleNumber: true,
          availability: true,
          lastActiveAt: true,
          multipleAttentionEnabled: true,
          branch: { select: { active: true } },
        },
      });
      if (
        !manager?.active ||
        manager.role !== UserRole.MANAGER ||
        manager.branchId !== branchId ||
        !manager.branch?.active
      ) {
        return { ineligible: true } as const;
      }
      if (manager.moduleNumber === null) return { noModule: true } as const;
      if (manager.availability !== WorkerAvailability.AVAILABLE) return { paused: true } as const;
      if (!manager.lastActiveAt || manager.lastActiveAt < presenceCutoff()) return { disconnected: true } as const;

      const activeCount = await tx.ticket.count({ where: { assignedToId: manager.id, status: { in: [TicketStatus.CALLED, TicketStatus.IN_SERVICE] } } });
      if (!manager.multipleAttentionEnabled && activeCount > 0) return { active: true } as const;
      if (manager.multipleAttentionEnabled && activeCount >= MAX_ACTIVE_TICKETS) return { activeLimit: true } as const;

      const updated = await tx.ticket.updateMany({
        where: { id, branchId, status: TicketStatus.WAITING },
        data: { status: TicketStatus.CALLED, assignedToId: manager.id },
      });
      if (!updated.count) return { unavailable: true } as const;

      await tx.ticketHistory.create({
        data: { ticketId: id, status: TicketStatus.CALLED, actorId: manager.id },
      });
      const ticket = await tx.ticket.findUniqueOrThrow({
        where: { id },
        include: {
          service: true,
          branch: true,
          assignedTo: { select: { id: true, name: true, moduleNumber: true } },
          operations: { include: { bank: true } },
        },
      });
      return { ticket, assignedTo: { id: manager.id, name: manager.name } } as const;
    }, { isolationLevel: "ReadCommitted" });

    if ("ineligible" in result) return Response.json({ error: "Esta opción solo está habilitada para jefes de sede activos." }, { status: 403 });
    if ("noModule" in result) return Response.json({ error: "Asigna un módulo antes de atender turnos." }, { status: 409 });
    if ("paused" in result) return Response.json({ error: "Marca Disponible antes de atender un turno." }, { status: 409 });
    if ("disconnected" in result) return Response.json({ error: "Tu sesión quedó desconectada. Actualiza la página e inténtalo nuevamente." }, { status: 409 });
    if ("active" in result) return Response.json({ error: "Confirma primero si el cliente llamado se acercó." }, { status: 409 });
    if ("activeLimit" in result) return Response.json({ error: `Ya tienes el máximo de ${MAX_ACTIVE_TICKETS} tickets activos. Finaliza o deriva uno antes de llamar otro.` }, { status: 409 });
    if ("unavailable" in result) return Response.json({ error: "Ese ticket ya no está en espera. Actualiza la cola e inténtalo nuevamente." }, { status: 409 });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
