import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { Prisma, TicketStatus, UserRole, WorkerAvailability } from "@prisma/client";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { publicUserFields } from "@/lib/user-fields";
import { isRecentlyActive } from "@/lib/presence";
import { getTurnosBranchName } from "@/lib/branch-overrides";
import { branchIdentity, coreBranches, ensureCoreBranches, findOrCreateBranch } from "@/lib/branches";
import { ensureLargeRoomSchema } from "@/lib/large-room-schema";

const role = z.nativeEnum(UserRole);
const attendantRoles: UserRole[] = [UserRole.WORKER, UserRole.MANAGER];
const dni = z.string().trim().regex(/^\d{6,12}$/, "El ID debe ser un DNI válido.");
const registrosUser = z.object({
  name: z.string().trim().min(2),
  username: z.string().trim().min(3),
  dni: z.string().trim().nullable().optional(),
  role: z.string(),
  sede: z.string().trim().nullable().optional(),
});

export async function GET() {
  try {
    const user = await requireUser(UserRole.ADMIN, UserRole.MANAGER);
    if (user.role === UserRole.ADMIN) await Promise.all([ensureLargeRoomSchema(), ensureCoreBranches()]);
    const scope: Prisma.UserWhereInput = user.role === UserRole.MANAGER
      ? { branchId: user.branchId || -1, role: { not: UserRole.ADMIN } }
      : {};
    const branchScope = user.role === UserRole.MANAGER ? { id: user.branchId || -1 } : {};
    const [branches, services, banks, users, rates, largeRooms] = await Promise.all([
      prisma.branch.findMany({ where: branchScope, orderBy: { name: "asc" } }), prisma.service.findMany({ orderBy: { name: "asc" } }), prisma.bank.findMany({ orderBy: { name: "asc" } }),
      prisma.user.findMany({ where: { ...scope, active: true }, select: { ...publicUserFields, branch: true, services: { include: { service: true } } }, orderBy: { name: "asc" } }),
      prisma.rate.findMany({ include: { service: true, bank: true }, orderBy: { id: "asc" } }),
      user.role === UserRole.ADMIN ? prisma.largeRoom.findMany({ include: { branch: { select: { id: true, name: true } }, worker: { select: { id: true, name: true } }, tickets: { where: { status: { in: [TicketStatus.CALLED, TicketStatus.IN_SERVICE] } }, select: { id: true, code: true, clientName: true, status: true, service: { select: { name: true } } }, orderBy: { arrivedAt: "asc" } } }, orderBy: { branch: { name: "asc" } } }) : Promise.resolve([]),
    ]);
    return Response.json({ branches, services, banks, users: users.map((worker) => ({ ...worker, connected: isRecentlyActive(worker.lastActiveAt) })), rates, largeRooms });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireUser(UserRole.ADMIN, UserRole.MANAGER);
    const body = await request.json();
    if (body.action === "syncRegistrosUsers") {
      if (actor.role !== UserRole.ADMIN) return Response.json({ error: "Solo Admin puede sincronizar Registros ATK." }, { status: 403 });
      await ensureCoreBranches();
      const baseUrl = process.env.REGISTROS_ATK_URL?.replace(/\/$/, "");
      const secret = process.env.REGISTROS_ATK_SHARED_SECRET;
      if (!baseUrl || !secret) return Response.json({ error: "Falta configurar la conexión con Registros ATK." }, { status: 503 });
      const response = await fetch(`${baseUrl}/api/external/turnos/records`, { headers: { "X-Turnos-ATK-Key": secret }, cache: "no-store" });
      if (!response.ok) return Response.json({ error: "No se pudo obtener los usuarios de Registros ATK." }, { status: 502 });
      const parsed = z.object({ users: z.array(registrosUser) }).safeParse(await response.json());
      if (!parsed.success) return Response.json({ error: "Registros ATK devolvió usuarios inválidos." }, { status: 502 });
      let synchronized = 0;
      const conflicts: string[] = [];
      for (const source of parsed.data.users) {
        const sede = getTurnosBranchName(source.username, source.sede?.trim() || "General");
        const branch = await findOrCreateBranch(sede);
        const [byDni, byUsername] = await Promise.all([
          source.dni ? prisma.user.findUnique({ where: { dni: source.dni } }) : null,
          prisma.user.findUnique({ where: { username: source.username } }),
        ]);
        if (byDni && byUsername && byDni.id !== byUsername.id) {
          // Never merge two existing accounts implicitly: either may own tickets
          // or have local permissions. Report this identity for manual review.
          conflicts.push(source.username);
          continue;
        }
        const existing = byDni || byUsername;
        try {
          if (existing) {
            // Keep Turnos role, activation, module and service permissions local,
            // while aligning the identity and branch with Registros ATK.
            await prisma.user.update({ where: { id: existing.id }, data: { name: source.name, username: source.username, dni: source.dni || existing.dni, branchId: branch.id, availability: branch.id === existing.branchId ? undefined : WorkerAvailability.PAUSED } });
          } else {
            const sourceRole = source.role === "ADMIN" ? UserRole.ADMIN : source.role === "MANAGER" ? UserRole.MANAGER : UserRole.WORKER;
            const unusableLocalPassword = randomBytes(32).toString("hex");
            await prisma.user.create({ data: { name: source.name, username: source.username, dni: source.dni || null, role: sourceRole, branchId: branch.id, active: true, passwordHash: await bcrypt.hash(unusableLocalPassword, 12) } });
          }
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            conflicts.push(source.username);
            continue;
          }
          throw error;
        }
        // Credentials are verified directly by Registros ATK at login. This
        // sync endpoint never transfers passwords or password hashes.
        synchronized += 1;
      }
      return Response.json({ ok: true, count: synchronized, conflicts });
    }
    if (body.action === "branch") {
      if (actor.role !== UserRole.ADMIN) return Response.json({ error: "Solo Admin puede gestionar sedes." }, { status: 403 });
      const p = z.object({ id: z.number().int().optional(), name: z.string().min(2), code: z.string().min(2), address: z.string().optional(), active: z.boolean().default(true) }).parse(body);
      await ensureCoreBranches();
      const nameIdentity = branchIdentity(p.name);
      const codeIdentity = branchIdentity(p.code);
      const canonical = coreBranches.find((branch) => branch.code === nameIdentity.code || branch.code === codeIdentity.code);
      if (canonical) {
        const target = await prisma.branch.findUniqueOrThrow({ where: { code: canonical.code } });
        if (p.id && p.id !== target.id) return Response.json({ error: `Esa sede es un alias de ${target.name}; selecciona la sede unificada.` }, { status: 409 });
        if (p.id) {
          return Response.json({ branch: await prisma.branch.update({ where: { id: target.id }, data: { name: target.name, code: target.code, address: p.address, active: p.active } }) });
        }
        return Response.json({ branch: target });
      }
      return Response.json({ branch: p.id ? await prisma.branch.update({ where: { id: p.id }, data: p }) : await prisma.branch.create({ data: p }) });
    }
    if (body.action === "user") {
      const p = z.object({ id: z.number().int().optional(), name: z.string().min(2), username: z.string().min(3), dni: dni.optional(), role, branchId: z.number().int().nullable(), active: z.boolean(), password: z.string().min(6).optional() }).parse(body);
      if (actor.role === UserRole.MANAGER && ((p.role !== UserRole.WORKER && p.role !== UserRole.RECEPTION) || p.branchId !== actor.branchId)) return Response.json({ error: "Solo puedes administrar recepción y trabajadores de tu sede." }, { status: 403 });
      if (p.id) {
        const target = await prisma.user.findUnique({ where: { id: p.id }, select: { role: true, branchId: true } });
        if (!target) return Response.json({ error: "Usuario no encontrado." }, { status: 404 });
        if (actor.role === UserRole.MANAGER && (target.branchId !== actor.branchId || (target.role !== UserRole.WORKER && target.role !== UserRole.RECEPTION))) return Response.json({ error: "No puedes modificar esta cuenta." }, { status: 403 });
      }
      const sameUsername = await prisma.user.findUnique({ where: { username: p.username } });
      if (sameUsername && sameUsername.id !== p.id) return Response.json({ error: `El usuario @${p.username} ya existe. Para enlazarlo, inicia sesión con esas credenciales o usa otro usuario.` }, { status: 409 });
      if (p.dni) { const sameDni = await prisma.user.findUnique({ where: { dni: p.dni } }); if (sameDni && sameDni.id !== p.id) return Response.json({ error: "Ese DNI ya está vinculado a otro usuario." }, { status: 409 }); }
      const data = { name: p.name, username: p.username, dni: p.dni || null, role: p.role, branchId: p.branchId, active: p.active, ...(p.password ? { passwordHash: await bcrypt.hash(p.password, 12) } : {}) };
      const targetWhere = { id: p.id, ...(actor.role === UserRole.MANAGER ? { branchId: actor.branchId, role: { in: [UserRole.WORKER, UserRole.RECEPTION] } } : {}) };
      return Response.json({ user: p.id ? await prisma.user.update({ where: targetWhere, data, select: publicUserFields }) : await prisma.user.create({ data: { ...data, passwordHash: data.passwordHash || await bcrypt.hash("Cambiar123!", 12) }, select: publicUserFields }) });
    }
    if (body.action === "deleteUser") {
      const p = z.object({ id: z.number().int() }).parse(body); const target = await prisma.user.findUnique({ where: { id: p.id } });
      if (!target) return Response.json({ error: "Usuario no encontrado." }, { status: 404 });
      if (target.id === actor.id) return Response.json({ error: "No puedes eliminar tu propia cuenta." }, { status: 400 });
      if (actor.role === UserRole.MANAGER && (target.branchId !== actor.branchId || (target.role !== UserRole.WORKER && target.role !== UserRole.RECEPTION))) return Response.json({ error: "Solo puedes eliminar usuarios de atención de tu sede." }, { status: 403 });
      const [created, assigned, history] = await Promise.all([prisma.ticket.count({ where: { createdById: target.id } }), prisma.ticket.count({ where: { assignedToId: target.id } }), prisma.ticketHistory.count({ where: { actorId: target.id } })]);
      if (created + assigned + history > 0) { await prisma.user.update({ where: { id: target.id }, data: { active: false, availability: WorkerAvailability.PAUSED } }); return Response.json({ ok: true, deactivated: true }); }
      await prisma.user.delete({ where: { id: target.id } }); return Response.json({ ok: true, deactivated: false });
    }
    if (body.action === "setAvailability") {
      const p = z.object({ userId: z.number().int(), available: z.boolean() }).parse(body);
      const worker = await prisma.user.findUnique({ where: { id: p.userId } });
      if (!worker || !attendantRoles.includes(worker.role) || (actor.role === UserRole.MANAGER && worker.branchId !== actor.branchId)) return Response.json({ error: "No puedes cambiar el estado de este usuario." }, { status: 403 });
      if (p.available && !worker.moduleNumber) return Response.json({ error: "Asigna un módulo antes de activar la atención." }, { status: 400 });
      await prisma.user.update({ where: { id: p.userId }, data: { availability: p.available ? WorkerAvailability.AVAILABLE : WorkerAvailability.PAUSED } });
      return Response.json({ ok: true });
    }
    if (body.action === "userBranch") {
      if (actor.role !== UserRole.ADMIN) return Response.json({ error: "Solo Admin puede cambiar la sede de un usuario." }, { status: 403 });
      const p = z.object({ userId: z.number().int(), branchId: z.number().int() }).parse(body);
      const [worker, branch] = await Promise.all([
        prisma.user.findUnique({ where: { id: p.userId }, select: { id: true, role: true, branchId: true, moduleNumber: true } }),
        prisma.branch.findUnique({ where: { id: p.branchId }, select: { id: true, active: true, name: true } }),
      ]);
      if (!worker || !attendantRoles.includes(worker.role)) return Response.json({ error: "Usuario de atención no encontrado." }, { status: 404 });
      if (!branch?.active) return Response.json({ error: "La sede seleccionada no está activa." }, { status: 400 });
      if (worker.branchId === branch.id) return Response.json({ ok: true, branch: branch.name });
      if (worker.moduleNumber && await prisma.user.findFirst({ where: { id: { not: worker.id }, branchId: branch.id, moduleNumber: worker.moduleNumber } })) {
        return Response.json({ error: `El módulo ${worker.moduleNumber} ya está ocupado en ${branch.name}.` }, { status: 409 });
      }
      const activeTickets = await prisma.ticket.count({ where: { assignedToId: worker.id, status: { in: [TicketStatus.CALLED, TicketStatus.IN_SERVICE] } } });
      if (activeTickets) return Response.json({ error: "Finaliza o libera sus turnos activos antes de cambiar de sede." }, { status: 409 });
      await prisma.user.update({ where: { id: worker.id }, data: { branchId: branch.id, availability: WorkerAvailability.PAUSED } });
      return Response.json({ ok: true, branch: branch.name });
    }
    if (body.action === "workerServices") {
      const p = z.object({ userId: z.number().int(), serviceIds: z.array(z.number().int()), moduleNumber: z.number().int().min(1).max(99).nullable().optional(), dni: dni.nullable().optional(), available: z.boolean().optional(), swapWithUserId: z.number().int().optional() }).parse(body);
      const worker = await prisma.user.findUnique({ where: { id: p.userId } });
      if (!worker || !attendantRoles.includes(worker.role) || (actor.role === UserRole.MANAGER && worker.branchId !== actor.branchId)) return Response.json({ error: "No puedes modificar este usuario de atención." }, { status: 403 });
      const nextModule = p.moduleNumber ?? null;
      if (p.available && !nextModule) return Response.json({ error: "Asigna un módulo antes de activar la atención." }, { status: 400 });
      if (p.dni) { const sameDni = await prisma.user.findUnique({ where: { dni: p.dni } }); if (sameDni && sameDni.id !== p.userId) return Response.json({ error: "Ese DNI ya está vinculado a otro usuario." }, { status: 409 }); }
      const result = await prisma.$transaction(async (tx) => {
        if (worker.branchId) await tx.$queryRaw`SELECT pg_advisory_xact_lock(${worker.branchId})::text`;
        const currentWorker = await tx.user.findUnique({ where: { id: p.userId } });
        if (!currentWorker || !attendantRoles.includes(currentWorker.role) || currentWorker.branchId !== worker.branchId) return { error: "El colaborador cambió de sede o ya no está disponible." };
        const occupied = nextModule ? await tx.user.findFirst({ where: { id: { not: p.userId }, branchId: currentWorker.branchId, moduleNumber: nextModule, active: true }, select: { id: true, name: true, moduleNumber: true } }) : null;
        const activeStatuses = { in: [TicketStatus.CALLED, TicketStatus.IN_SERVICE] };
        let swapped = false;
        let activeTicketPreserved = false;
        if (occupied) {
          if (!currentWorker.moduleNumber) return { error: `${occupied.name} ocupa el módulo ${nextModule}. Asigna primero un módulo libre a ${currentWorker.name} para poder intercambiar.` };
          if (!p.swapWithUserId) return { moduleConflict: { id: occupied.id, name: occupied.name, moduleNumber: occupied.moduleNumber } };
          if (p.swapWithUserId !== occupied.id) return { error: "La asignación del módulo cambió. Actualiza la página e inténtalo otra vez." };
          const active = await tx.ticket.findMany({ where: { assignedToId: { in: [currentWorker.id, occupied.id] }, status: activeStatuses }, select: { assignedToId: true }, distinct: ["assignedToId"] });
          await tx.user.update({ where: { id: occupied.id }, data: { moduleNumber: currentWorker.moduleNumber, availability: WorkerAvailability.AVAILABLE, lastActiveAt: new Date() } });
          await tx.user.update({ where: { id: currentWorker.id }, data: { moduleNumber: nextModule, dni: p.dni === undefined ? currentWorker.dni : p.dni, availability: WorkerAvailability.AVAILABLE, lastActiveAt: new Date() } });
          swapped = true;
          activeTicketPreserved = active.length > 0;
        } else {
          if (p.swapWithUserId) return { error: "La asignación del módulo cambió. Actualiza la página e inténtalo otra vez." };
          const activeTicket = await tx.ticket.findFirst({ where: { assignedToId: currentWorker.id, status: activeStatuses }, select: { id: true } });
          if (!nextModule && activeTicket) return { error: "No puedes quitar el módulo mientras tengas un cliente llamado o en atención. Asígnate otro módulo para conservar su atención." };
          const moduleChanged = nextModule !== currentWorker.moduleNumber;
          await tx.user.update({ where: { id: currentWorker.id }, data: { moduleNumber: nextModule, dni: p.dni === undefined ? currentWorker.dni : p.dni, availability: moduleChanged ? WorkerAvailability.AVAILABLE : p.available === undefined ? currentWorker.availability : p.available ? WorkerAvailability.AVAILABLE : WorkerAvailability.PAUSED, ...(moduleChanged ? { lastActiveAt: new Date() } : {}) } });
          activeTicketPreserved = Boolean(activeTicket && moduleChanged);
        }
        await tx.workerService.deleteMany({ where: { userId: currentWorker.id } });
        await tx.workerService.createMany({ data: p.serviceIds.map((serviceId) => ({ userId: currentWorker.id, serviceId })) });
        return { ok: true, swapped, activeTicketPreserved };
      }, { isolationLevel: "ReadCommitted" });
      if ("moduleConflict" in result) return Response.json(result, { status: 409 });
      if ("error" in result) return Response.json(result, { status: 409 });
      return Response.json(result);
    }
    if (body.action === "rate") {
      if (actor.role !== UserRole.ADMIN) return Response.json({ error: "Solo Admin puede configurar tasas." }, { status: 403 });
      const p = z.object({ serviceId: z.number().int(), bankId: z.number().int(), rate: z.number().min(0).max(100) }).parse(body);
      return Response.json({ rate: await prisma.rate.upsert({ where: { serviceId_bankId: { serviceId: p.serviceId, bankId: p.bankId } }, update: { rate: p.rate }, create: p }) });
    }
    return Response.json({ error: "Acción inválida." }, { status: 400 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return Response.json({ error: "El usuario o DNI ya existe." }, { status: 409 });
    return errorResponse(error);
  }
}
