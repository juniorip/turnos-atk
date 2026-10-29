import { TicketStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createTicket } from "@/lib/ticket";
import { canonicalBranchCode, ensureCoreBranches } from "@/lib/branches";
import { LIMA_DISTRICTS } from "@/lib/lima-districts";
const schema=z.object({branchCode:z.string().min(2),dni:z.string().regex(/^\d{6,12}$/),documentType:z.enum(["DNI","CE"]).default("DNI"),clientName:z.string().min(3),district:z.enum(LIMA_DISTRICTS),isPreferential:z.boolean().default(false),serviceId:z.number().int()});
export async function POST(request: Request) {
  try {
    const body = schema.safeParse(await request.json());
    if (!body.success || (body.data.documentType === "DNI" && !/^\d{8}$/.test(body.data.dni))) return Response.json({ error: "Completa correctamente tus datos." }, { status: 400 });
    await ensureCoreBranches();
    const normalizedBranchCode = canonicalBranchCode(body.data.branchCode);
    const branch = await prisma.branch.findFirst({ where: { code: normalizedBranchCode, active: true }, select: { id: true } });
    if (!branch) return Response.json({ error: "La sede no está disponible." }, { status: 400 });
    const { branchCode, ...data } = body.data;
    const ticket = await createTicket({ ...data, branchId: branch.id });
    return Response.json({ ticket }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "CATALOG_UNAVAILABLE") return Response.json({ error: "La sede o el trámite no están disponibles." }, { status: 400 });
    return Response.json({ error: "No se pudo generar el ticket. Intenta nuevamente." }, { status: 500 });
  }
}
