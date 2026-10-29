import { TicketStatus, UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireUser(UserRole.ADMIN, UserRole.MANAGER);
    const scope = user.role === UserRole.MANAGER ? { branchId: user.branchId ?? -1 } : {};
    const groups = await prisma.ticket.groupBy({
      by: ["dni"],
      where: { ...scope, status: { not: TicketStatus.CANCELLED } },
      _count: { _all: true },
      orderBy: [{ _count: { dni: "desc" } }, { _max: { arrivedAt: "desc" } }],
      take: 100,
    });
    const frequent = groups.filter((group) => group._count._all > 1).slice(0, 20);
    if (!frequent.length) return Response.json({ clients: [] });

    const records = await prisma.ticket.findMany({
      where: { ...scope, dni: { in: frequent.map((group) => group.dni) }, status: { not: TicketStatus.CANCELLED } },
      select: { dni: true, clientName: true, arrivedAt: true, service: { select: { name: true } } },
      orderBy: { arrivedAt: "desc" },
    });
    const latestByDni = new Map(records.map((ticket) => [ticket.dni, ticket]));
    const clients = frequent.flatMap((group) => {
      const latest = latestByDni.get(group.dni);
      return latest ? [{
        name: latest.clientName,
        visits: group._count._all,
        lastVisit: latest.arrivedAt,
        lastService: latest.service.name,
      }] : [];
    });
    return Response.json({ clients });
  } catch (error) {
    return errorResponse(error);
  }
}
