import { TicketStatus, UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function parseLimaDate(value: string, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}-05:00`);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER);
    const params = new URL(request.url).searchParams;
    const from = parseLimaDate(params.get("from") || "");
    const to = parseLimaDate(params.get("to") || "", true);
    if (!from || !to || from > to) {
      return Response.json({ error: "Selecciona un rango de fechas válido." }, { status: 400 });
    }

    const tickets = await prisma.ticket.findMany({
      where: {
        assignedToId: user.id,
        status: { in: [TicketStatus.COMPLETED, TicketStatus.FAILED, TicketStatus.CANCELLED] },
        completedAt: { gte: from, lte: to },
      },
      include: {
        service: true,
        operations: { include: { service: true, bank: { select: { id: true, name: true } } }, orderBy: { id: "asc" } },
        history: { orderBy: { at: "asc" }, include: { actor: { select: { name: true } } } },
      },
      orderBy: { completedAt: "desc" },
    });
    return Response.json({ tickets });
  } catch (error) {
    return errorResponse(error);
  }
}
