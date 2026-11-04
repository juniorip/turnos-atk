import { TicketStatus, UserRole, WorkerAvailability } from "@prisma/client";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { presenceCutoff } from "@/lib/presence";
import { ensureLargeRoomSchema } from "@/lib/large-room-schema";

const schema = z.object({ recipientId: z.union([z.number().int().positive(), z.literal("LARGE_ROOM")]) });
const activeStatuses = [TicketStatus.CALLED, TicketStatus.IN_SERVICE];
const MAX_ACTIVE_TICKETS = 2;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER, UserRole.ADMIN);
    await ensureLargeRoomSchema();
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Ticket inválido." }, { status: 400 });
    const isManager = user.role === UserRole.MANAGER;
    const isAdmin = user.role === UserRole.ADMIN;
    // Managers may move any active ticket within their own branch. Advisors
    // may only hand off a ticket currently assigned to them.
    const ticket = await prisma.ticket.findFirst({
      where: {
        id,
        ...(isManager ? { branchId: user.branchId ?? -1 } : isAdmin ? {} : { assignedToId: user.id }),
        status: { in: isManager || isAdmin ? [TicketStatus.WAITING, ...activeStatuses] : activeStatuses },
      },
      select: { id: true, serviceId: true, branchId: true, largeRoomId: true, assignedToId: true },
    });
    if (!ticket) return Response.json({ error: "El ticket no está asignado a tu atención." }, { status: 404 });
    const candidates = await prisma.user.findMany({
      where: {
        branchId: ticket.branchId,
        id: { notIn: [user.id, ...(ticket.assignedToId ? [ticket.assignedToId] : [])] },
        role: { in: [UserRole.WORKER, UserRole.MANAGER] },
        moduleNumber: { not: null }, active: true,
        availability: WorkerAvailability.AVAILABLE,
        lastActiveAt: { gte: presenceCutoff() },
      },
      select: { id: true, name: true, moduleNumber: true, multipleAttentionEnabled: true },
      orderBy: { name: "asc" },
    });
    const activeCounts = candidates.length ? await prisma.ticket.groupBy({
      by: ["assignedToId"],
      where: { assignedToId: { in: candidates.map((advisor) => advisor.id) }, status: { in: activeStatuses } },
      _count: { _all: true },
    }) : [];
    const activeCountByAdvisor = new Map(activeCounts.map((row) => [row.assignedToId, row._count._all]));
    const advisors = candidates.flatMap((advisor) => {
      const activeCount = activeCountByAdvisor.get(advisor.id) || 0;
      if (activeCount > 0 && (!advisor.multipleAttentionEnabled || activeCount >= MAX_ACTIVE_TICKETS)) return [];
      return [{ id: advisor.id, name: advisor.name, moduleNumber: advisor.moduleNumber, activeCount, acceptsMultiple: advisor.multipleAttentionEnabled }];
    });
    const room = await prisma.largeRoom.findUnique({ where: { branchId: ticket.branchId }, include: { branch: { select: { name: true } }, worker: { select: { name: true } } } });
    const largeRoom = room?.active && room.worker && room.id !== ticket.largeRoomId
      ? { branchName: room.branch.name, advisorName: room.worker.name }
      : null;
    return Response.json({ advisors, largeRoom });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER, UserRole.ADMIN);
    await ensureLargeRoomSchema();
    const id = Number((await params).id);
    const body = schema.safeParse(await request.json());
    if (!Number.isSafeInteger(id) || id <= 0 || !body.success) return Response.json({ error: "Datos de transferencia inválidos." }, { status: 400 });
    const result = await prisma.$transaction(async (tx) => {
      const isManager = user.role === UserRole.MANAGER;
      const isAdmin = user.role === UserRole.ADMIN;
      const ticket = await tx.ticket.findFirst({
        where: {
          id,
          ...(isManager ? { branchId: user.branchId ?? -1 } : isAdmin ? {} : { assignedToId: user.id }),
          status: { in: isManager || isAdmin ? [TicketStatus.WAITING, ...activeStatuses] : activeStatuses },
        },
        select: { id: true, branchId: true, serviceId: true, status: true, assignedToId: true },
      });
      if (!ticket) return { error: "El ticket ya no está disponible para transferirse.", status: 409 } as const;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${ticket.branchId})::text`;
      if (body.data.recipientId === "LARGE_ROOM") {
        const room = await tx.largeRoom.findUnique({ where: { branchId: ticket.branchId }, include: { branch: { select: { name: true } }, worker: { select: { id: true, name: true } } } });
        if (!room?.active || !room.worker) return { error: "La sala grande ya no está activa en la sede de este cliente.", status: 409 } as const;
        const changed = await tx.ticket.updateMany({
          where: { id, ...(isManager || isAdmin ? {} : { assignedToId: user.id }), branchId: ticket.branchId, status: ticket.status },
          data: {
            assignedToId: room.worker.id,
            largeRoomId: room.id,
            ...(ticket.status === TicketStatus.WAITING ? { status: TicketStatus.IN_SERVICE, startedAt: new Date() } : {}),
          },
        });
        if (!changed.count) return { error: "El ticket cambió mientras se derivaba. Actualiza e inténtalo de nuevo.", status: 409 } as const;
        if (ticket.status === TicketStatus.WAITING) await tx.ticketHistory.create({ data: { ticketId: ticket.id, status: TicketStatus.IN_SERVICE, actorId: user.id } });
        return { largeRoom: { branchName: room.branch.name, advisorName: room.worker.name } } as const;
      }
      const recipient = await tx.user.findFirst({
        where: {
          id: body.data.recipientId, branchId: ticket.branchId, role: { in: [UserRole.WORKER, UserRole.MANAGER] },
          moduleNumber: { not: null }, active: true, availability: WorkerAvailability.AVAILABLE, lastActiveAt: { gte: presenceCutoff() },
          assigned: { none: { status: { in: activeStatuses } } },
        }, select: { id: true, name: true, moduleNumber: true, multipleAttentionEnabled: true },
      });
      if (!recipient) return { error: "Ese asesor ya no está disponible para recibir este trámite.", status: 409 } as const;
      if (recipient.id === ticket.assignedToId) return { error: "El ticket ya está asignado a ese asesor.", status: 409 } as const;
      const recipientActiveCount = await tx.ticket.count({ where: { assignedToId: recipient.id, status: { in: activeStatuses } } });
      if (recipientActiveCount > 0 && (!recipient.multipleAttentionEnabled || recipientActiveCount >= MAX_ACTIVE_TICKETS)) {
        return { error: recipient.multipleAttentionEnabled ? "Ese asesor ya alcanzó el máximo de 2 tickets activos." : "Ese asesor ya tiene un cliente. Debe activar Atención múltiple para recibir otro ticket." , status: 409 } as const;
      }
      const changed = await tx.ticket.updateMany({
        where: { id, ...(isManager || isAdmin ? {} : { assignedToId: user.id }), branchId: ticket.branchId, status: ticket.status },
        data: { assignedToId: recipient.id, largeRoomId: null, ...(ticket.status === TicketStatus.WAITING ? { status: TicketStatus.CALLED } : {}) },
      });
      if (!changed.count) return { error: "El ticket cambió mientras se transfería. Actualiza e inténtalo de nuevo.", status: 409 } as const;
      if (ticket.status === TicketStatus.WAITING) {
        await tx.ticketHistory.create({ data: { ticketId: ticket.id, status: TicketStatus.CALLED, actorId: user.id } });
      }
      return { advisor: recipient } as const;
    }, { isolationLevel: "ReadCommitted" });
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    if ("largeRoom" in result) return Response.json({ largeRoom: result.largeRoom });
    return Response.json({ advisor: result.advisor });
  } catch (error) { return errorResponse(error); }
}
