import { UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lookupPancakeCustomerByDni } from "@/lib/pancake";

export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(UserRole.ADMIN, UserRole.MANAGER, UserRole.WORKER);
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Ticket inválido." }, { status: 400 });
    const ticket = await prisma.ticket.findFirst({
      where: {
        id,
        ...(user.role === UserRole.ADMIN ? {} : {
          branchId: user.branchId ?? -1,
          ...(user.role === UserRole.WORKER ? { assignedToId: user.id } : {}),
        }),
      },
      select: { dni: true },
    });
    if (!ticket) return Response.json({ error: "Ticket no disponible." }, { status: 404 });
    const result = await lookupPancakeCustomerByDni(ticket.dni);
    if (!result.ok) return Response.json({ error: "No se pudo comprobar el registro en Pancake." }, { status: result.reason === "not_configured" ? 503 : 502, headers: { "Cache-Control": "no-store" } });
    // El asesor recibe solo el estado; las notas y cuentas siguen restringidas al administrador.
    return Response.json({ registered: result.found, complete: result.complete }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
