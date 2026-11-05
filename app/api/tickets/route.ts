import { TicketStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createTicket } from "@/lib/ticket";
import { sortTicketsForCall } from "@/lib/queue-order";
import { publicUserFields } from "@/lib/user-fields";
import { LIMA_DISTRICTS } from "@/lib/lima-districts";
import { after } from "next/server";
import { warmWaitingPancake } from "@/lib/ticket-pancake";
export const maxDuration = 60;
const schema=z.object({dni:z.string().regex(/^\d{6,12}$/),documentType:z.enum(["DNI","CE"]).default("DNI"),clientName:z.string().min(3),district:z.enum(LIMA_DISTRICTS),isPreferential:z.boolean().default(false),serviceId:z.number().int(),phone:z.string().optional(),notes:z.string().optional(),branchId:z.number().int().optional()});
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;
    const requestedBranchId = params.get("branchId");
    const parsedBranchId = requestedBranchId ? Number(requestedBranchId) : 0;
    if (user.role === UserRole.ADMIN && requestedBranchId && (!Number.isSafeInteger(parsedBranchId) || parsedBranchId <= 0)) {
      return Response.json({ error: "Sede inválida." }, { status: 400 });
    }
    const where = user.role === UserRole.ADMIN
      ? (parsedBranchId ? { branchId: parsedBranchId } : {})
      : { branchId: user.branchId ?? -1 };
    const tickets = await prisma.ticket.findMany({
      where: { ...where, status: { in: [TicketStatus.WAITING, TicketStatus.CALLED, TicketStatus.IN_SERVICE] } },
      include: { service: true, branch: { select: { id: true, name: true } }, assignedTo: { select: publicUserFields } },
    });
    const sorted = sortTicketsForCall(tickets);
    after(() => warmWaitingPancake(sorted.filter(ticket => ticket.status === TicketStatus.WAITING)));
    return Response.json({ tickets: sorted });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(UserRole.RECEPTION, UserRole.ADMIN);
    const body = schema.safeParse(await request.json());
    if (!body.success || (body.data.documentType === "DNI" && !/^\d{8}$/.test(body.data.dni))) return Response.json({ error: "Datos de ticket inválidos." }, { status: 400 });
    const { branchId: requestedBranchId, ...data } = body.data;
    const branchId = user.role === UserRole.ADMIN ? requestedBranchId ?? user.branchId : user.branchId;
    if (!branchId) return Response.json({ error: "Selecciona una sede." }, { status: 400 });
    const ticket = await createTicket({ ...data, branchId, createdById: user.id });
    after(() => warmWaitingPancake([ticket]));
    return Response.json({ ticket }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "CATALOG_UNAVAILABLE") return Response.json({ error: "La sede o el trámite no están disponibles." }, { status: 400 });
    return errorResponse(error);
  }
}
