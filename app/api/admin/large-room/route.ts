import { TicketStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureLargeRoomSchema } from "@/lib/large-room-schema";

const assignSchema = z.object({
  action: z.literal("assign"),
  branchId: z.number().int().positive(),
  ticketIds: z.array(z.number().int().positive()).min(1),
}).refine((value) => new Set(value.ticketIds).size === value.ticketIds.length, "No repitas tickets.");

export async function GET() {
  try {
    await requireUser(UserRole.ADMIN);
    await ensureLargeRoomSchema();
    const rooms = await prisma.largeRoom.findMany({
      include: {
        branch: { select: { id: true, name: true } },
        worker: { select: { id: true, name: true, username: true } },
        tickets: {
          where: { status: { in: [TicketStatus.CALLED, TicketStatus.IN_SERVICE] } },
          select: { id: true, code: true, clientName: true, status: true, service: { select: { name: true } } },
          orderBy: { arrivedAt: "asc" },
        },
      },
      orderBy: { branch: { name: "asc" } },
    });
    return Response.json({ rooms });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireUser(UserRole.ADMIN);
    await ensureLargeRoomSchema();
    const raw = await request.json();
    const assign = assignSchema.safeParse(raw);
    if (!assign.success) return Response.json({ error: "Datos de asignación inválidos." }, { status: 400 });
    const { branchId, ticketIds } = assign.data;
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${branchId})::text`;
      const room = await tx.largeRoom.findUnique({ where: { branchId } });
      if (!room?.active || !room.workerId) return { error: "La sala no está activa. El asesor debe activarla desde su panel." } as const;
      const worker = await tx.user.findFirst({ where: { id: room.workerId, active: true, branchId, role: { in: [UserRole.WORKER, UserRole.MANAGER] } }, select: { id: true } });
      if (!worker) return { error: "El asesor de la sala ya no está activo en esta sede." } as const;
      const tickets = await tx.ticket.findMany({ where: { id: { in: ticketIds }, branchId, status: TicketStatus.WAITING }, select: { id: true } });
      if (tickets.length !== ticketIds.length) return { error: "Algunos clientes ya no están en espera. Actualiza la lista e inténtalo otra vez." } as const;
      const startedAt = new Date();
      for (const ticket of tickets) {
        const updated = await tx.ticket.updateMany({
          where: { id: ticket.id, branchId, status: TicketStatus.WAITING },
          data: { assignedToId: worker.id, largeRoomId: room.id, status: TicketStatus.IN_SERVICE, startedAt },
        });
        if (!updated.count) throw new Error("Uno de los clientes ya fue asignado. Vuelve a cargar la cola.");
        await tx.ticketHistory.create({ data: { ticketId: ticket.id, status: TicketStatus.IN_SERVICE, actorId: actor.id } });
      }
      return { assigned: tickets.length, workerId: worker.id } as const;
    });
    if ("error" in result) return Response.json({ error: result.error }, { status: 409 });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
