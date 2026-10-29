import { TicketStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { ensureLargeRoomSchema } from "@/lib/large-room-schema";
import { prisma } from "@/lib/prisma";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["activate", "deactivate"]) }),
  z.object({ action: z.literal("assign"), ticketIds: z.array(z.number().int().positive()).min(1) })
    .refine((value) => new Set(value.ticketIds).size === value.ticketIds.length, "No repitas clientes."),
]);

export async function POST(request: Request) {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER);
    await ensureLargeRoomSchema();
    const body = schema.safeParse(await request.json());
    if (!body.success) return Response.json({ error: "Acción de sala inválida." }, { status: 400 });
    if (!user.branchId) return Response.json({ error: "No tienes una sede asignada." }, { status: 403 });
    const branchId = user.branchId;

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${branchId})::text`;
      const advisor = await tx.user.findUnique({ where: { id: user.id }, select: { active: true, branchId: true, role: true } });
      if (!advisor?.active || advisor.branchId !== user.branchId || (advisor.role !== UserRole.WORKER && advisor.role !== UserRole.MANAGER)) {
        return { error: "Tu usuario no está habilitado para atender en esta sede." } as const;
      }
      const room = await tx.largeRoom.findUnique({ where: { branchId } });
      if (body.data.action === "assign") {
        if (!room?.active || room.workerId !== user.id) return { error: "Activa tu sala grande antes de elegir clientes." } as const;
        const tickets = await tx.ticket.findMany({ where: { id: { in: body.data.ticketIds }, branchId, status: TicketStatus.WAITING }, select: { id: true } });
        if (tickets.length !== body.data.ticketIds.length) return { error: "Algunos clientes ya no están en espera. Actualiza la lista e inténtalo otra vez." } as const;
        const startedAt = new Date();
        for (const ticket of tickets) {
          const updated = await tx.ticket.updateMany({
            where: { id: ticket.id, branchId, status: TicketStatus.WAITING },
            data: { assignedToId: user.id, largeRoomId: room.id, status: TicketStatus.IN_SERVICE, startedAt },
          });
          if (!updated.count) throw new Error("Uno de los clientes ya fue asignado. Actualiza la cola e inténtalo otra vez.");
          await tx.ticketHistory.create({ data: { ticketId: ticket.id, status: TicketStatus.IN_SERVICE, actorId: user.id } });
        }
        return { assigned: tickets.length, roomId: room.id } as const;
      }
      if (body.data.action === "activate") {
        if (room?.active && room.workerId !== user.id) {
          const occupiedBy = room.workerId ? await tx.user.findUnique({ where: { id: room.workerId }, select: { name: true } }) : null;
          return { error: `La sala grande está activa con ${occupiedBy?.name || "otro asesor"}.` } as const;
        }
        const activated = await tx.largeRoom.upsert({
          where: { branchId },
          update: { active: true, workerId: user.id },
          create: { branchId, workerId: user.id, active: true, capacity: 10 },
        });
        return { active: true, roomId: activated.id } as const;
      }
      if (!room?.active || room.workerId !== user.id) return { error: "No tienes una sala grande activa." } as const;
      await tx.ticket.updateMany({
        where: { largeRoomId: room.id, status: { in: [TicketStatus.CALLED, TicketStatus.IN_SERVICE] } },
        data: { largeRoomId: null },
      });
      await tx.largeRoom.update({ where: { id: room.id }, data: { active: false } });
      return { active: false, roomId: room.id } as const;
    });
    if ("error" in result) return Response.json({ error: result.error }, { status: 409 });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
