import { TicketStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ status: z.enum(["IN_SERVICE", "FAILED"]) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER);
    const id = Number((await params).id);
    const body = schema.safeParse(await request.json());
    if (!body.success) return Response.json({ error: "Estado inválido." }, { status: 400 });

    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Ticket inválido." }, { status: 400 });
    const status = body.data.status as TicketStatus;
    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const transitioned = await tx.ticket.updateMany({
        where: { id, assignedToId: user.id, branchId: user.branchId ?? -1, status: TicketStatus.CALLED },
        data: {
          status,
          ...(status === TicketStatus.IN_SERVICE ? { startedAt: now } : { completedAt: now }),
        },
      });
      if (!transitioned.count) return null;
      await tx.ticketHistory.create({ data: { ticketId: id, status, actorId: user.id } });
      return tx.ticket.findUnique({ where: { id }, include: { service: true } });
    });
    if (!updated) return Response.json({ error: "El llamado ya fue resuelto o no te pertenece." }, { status: 409 });
    return Response.json({ ticket: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
