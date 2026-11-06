import { UserRole } from "@prisma/client";
import { requireUser, errorResponse } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readTicketPancake } from "@/lib/ticket-pancake";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(UserRole.ADMIN, UserRole.WORKER, UserRole.MANAGER);
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Ticket inválido." }, { status: 400 });
    const ticket = await prisma.ticket.findFirst({
      where: { id, ...(user.role === UserRole.ADMIN ? {} : { branchId: user.branchId ?? -1, assignedToId: user.id }) }, select: { id: true, dni: true },
    });
    if (!ticket) return Response.json({ error: "Ticket no disponible." }, { status: 404 });
    const cached = await readTicketPancake(ticket);
    // This endpoint only reads the result cached while the ticket was waiting.
    // Searches are intentionally started by the queue endpoints, never during
    // an active customer visit.
    return Response.json(cached, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
