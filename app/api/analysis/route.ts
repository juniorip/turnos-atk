import { Prisma, UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function parseDate(value: string | null, endOfDay = false) {
  if (!value) return null;
  // Date inputs from the UI are calendar dates in the application's Lima timezone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}-05:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(UserRole.ADMIN, UserRole.MANAGER);
    const q = new URL(request.url).searchParams;
    const from = parseDate(q.get("from"));
    const to = parseDate(q.get("to"), true) || (q.has("from") ? new Date() : null);
    const dateRange: Prisma.DateTimeFilter | undefined = from || to
      ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
      : undefined;
    const where: Prisma.TicketWhereInput = {
      ...(user.role === UserRole.MANAGER
        ? { branchId: user.branchId || -1 }
        : q.get("branchId") ? { branchId: Number(q.get("branchId")) } : {}),
      ...(q.get("status") === "HISTORY"
        ? { status: { in: ["COMPLETED", "FAILED"] } }
        : q.get("status") ? { status: q.get("status") as never } : {}),
      ...(q.get("serviceId") ? { serviceId: Number(q.get("serviceId")) } : {}),
      ...(q.get("workerId") ? { assignedToId: Number(q.get("workerId")) } : {}),
      ...(dateRange
        ? (["HISTORY", "COMPLETED", "FAILED"].includes(q.get("status") || "")
          ? { completedAt: dateRange }
          : { arrivedAt: dateRange })
        : {}),
    };
    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        branch: true,
        service: true,
        createdBy: { select: { name: true } },
        assignedTo: { select: { name: true } },
        history: { orderBy: { at: "asc" }, include: { actor: { select: { name: true } } } },
        operations: { include: { bank: true, service: true } },
      },
      orderBy: { arrivedAt: "desc" },
      take: 300,
    });
    return Response.json({ tickets });
  } catch (error) {
    return errorResponse(error);
  }
}
