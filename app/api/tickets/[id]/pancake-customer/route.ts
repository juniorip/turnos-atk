import { UserRole } from "@prisma/client";
import { after } from "next/server";
import { requireUser, errorResponse } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fillTicketPancake, readTicketPancake } from "@/lib/ticket-pancake";

export const maxDuration = 60;
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(UserRole.ADMIN, UserRole.WORKER, UserRole.MANAGER);
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Ticket inválido." }, { status: 400 });
    const ticket = await prisma.ticket.findFirst({
      where: { id, ...(user.role === UserRole.ADMIN ? {} : { branchId: user.branchId ?? -1, assignedToId: user.id }) }, select: { id: true, dni: true },
    });
    if (!ticket) return Response.json({ error: "Ticket no disponible." }, { status: 404 });
    const refresh = new URL(request.url).searchParams.get("refresh") === "1";
    const cached = await readTicketPancake(ticket);
    if (refresh || cached.state === "pending") {
      after(() => fillTicketPancake(ticket, refresh));
      return Response.json({ state: "pending" }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(cached, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
