import { TicketStatus, UserRole, WorkerAvailability } from "@prisma/client";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRecentlyActive } from "@/lib/presence";

const schema = z.object({ moduleNumber: z.number().int().min(1).max(99) });
const MIN_MODULE_CHOICES = 8;

export async function GET() {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER);
    if (!user.branchId) return Response.json({ error: "No tienes una sede asignada." }, { status: 400 });
    const [current, assigned, activeTickets] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id }, select: { active: true, branchId: true, moduleNumber: true, availability: true } }),
      prisma.user.findMany({
        where: { branchId: user.branchId, active: true, moduleNumber: { not: null }, role: { in: [UserRole.WORKER, UserRole.MANAGER] } },
        select: { id: true, name: true, moduleNumber: true, availability: true, lastActiveAt: true },
      }),
      prisma.ticket.findMany({ where: { branchId: user.branchId, status: { in: [TicketStatus.CALLED, TicketStatus.IN_SERVICE] } }, select: { assignedToId: true } }),
    ]);
    if (!current?.active || current.branchId !== user.branchId) return Response.json({ error: "Tu cuenta no está habilitada en esta sede." }, { status: 403 });
    const maxModule = Math.min(99, Math.max(MIN_MODULE_CHOICES, ...assigned.map((person) => person.moduleNumber || 0)));
    const activeOwners = new Set(activeTickets.map((ticket) => ticket.assignedToId));
    const modules = Array.from({ length: maxModule }, (_, index) => {
      const moduleNumber = index + 1;
      const occupant = assigned.find((person) => person.moduleNumber === moduleNumber);
      const canTakeover = Boolean(occupant && occupant.id !== user.id && (occupant.availability === WorkerAvailability.PAUSED || !isRecentlyActive(occupant.lastActiveAt)) && !activeOwners.has(occupant.id));
      return { moduleNumber, occupiedBy: occupant?.name || null, isMine: occupant?.id === user.id, canTakeover };
    });
    return Response.json({ moduleNumber: current.moduleNumber, availability: current.availability, modules }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER);
    const body = schema.safeParse(await request.json());
    if (!body.success) return Response.json({ error: "Elige un módulo válido entre 1 y 99." }, { status: 400 });
    if (!user.branchId) return Response.json({ error: "No tienes una sede asignada." }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${user.branchId})::text`;
      const manager = await tx.user.findUnique({ where: { id: user.id }, select: { active: true, branchId: true, moduleNumber: true } });
      if (!manager?.active || manager.branchId !== user.branchId) return { error: "Tu cuenta no está habilitada en esta sede." };

      const occupied = await tx.user.findFirst({
        where: { id: { not: user.id }, branchId: user.branchId, moduleNumber: body.data.moduleNumber, active: true },
        select: { id: true, name: true, availability: true, lastActiveAt: true },
      });
      let reclaimedModuleFrom: string | null = null;
      if (occupied) {
        const activeTicket = await tx.ticket.findFirst({ where: { assignedToId: occupied.id, status: { in: [TicketStatus.CALLED, TicketStatus.IN_SERVICE] } }, select: { id: true } });
        if ((occupied.availability !== WorkerAvailability.PAUSED && isRecentlyActive(occupied.lastActiveAt)) || activeTicket) return { error: `El módulo ${body.data.moduleNumber} sigue ocupado por ${occupied.name}. Solo se puede tomar si no está disponible o desconectado y no tiene un cliente llamado o en atención.` };
        await tx.user.update({ where: { id: occupied.id }, data: { moduleNumber: null, availability: WorkerAvailability.PAUSED } });
        reclaimedModuleFrom = occupied.name;
      }

      const updated = await tx.user.update({
        where: { id: user.id },
        // Active tickets remain assigned to this advisor and automatically follow
        // their new module. Changing modules keeps the advisor available.
        data: { moduleNumber: body.data.moduleNumber, availability: WorkerAvailability.AVAILABLE, lastActiveAt: new Date() },
        select: { moduleNumber: true, availability: true },
      });
      return { ...updated, reclaimedModuleFrom };
    }, { isolationLevel: "ReadCommitted" });

    if ("error" in result) return Response.json({ error: result.error }, { status: 409 });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
