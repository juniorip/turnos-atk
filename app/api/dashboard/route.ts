import { Prisma, TicketStatus, UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRecentlyActive } from "@/lib/presence";
import { registrosATKUserRoster } from "@/lib/registros-atk-user-roster";
import { ensureCoreBranches } from "@/lib/branches";
import { sortTicketsForCall } from "@/lib/queue-order";

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const volume = (items: { amount: number }[]) => items.reduce((total, item) => total + Number(item.amount), 0);
const utility = (items: { profit: number }[]) => items.reduce((total, item) => total + Number(item.profit), 0);
const BUSINESS_TIME_ZONE = "America/Lima";
let commercialCardReady: Promise<void> | null = null;

function utcDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function businessDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateKey(date);
}

function parseBusinessDate(dateKey: string, endOfDay = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const validation = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(validation.getTime()) || utcDateKey(validation) !== dateKey) return null;
  return new Date(`${dateKey}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}-05:00`);
}

function ensureCommercialCard() {
  commercialCardReady ??= prisma.bank.upsert({ where: { name: "Tarjeta Comercial" }, update: {}, create: { name: "Tarjeta Comercial" } })
    .then(() => undefined)
    .catch((error) => { commercialCardReady = null; throw error; });
  return commercialCardReady;
}

let efectivizacionBanksReady: Promise<void> | null = null;
function ensureEfectivizacionBanks() {
  efectivizacionBanksReady ??= Promise.all(["CMR", "IO"].map((name) =>
    prisma.bank.upsert({ where: { name }, update: { active: true }, create: { name, active: true } }),
  )).then(() => undefined).catch((error) => { efectivizacionBanksReady = null; throw error; });
  return efectivizacionBanksReady;
}

function getRange(period: string) {
  const now = new Date();
  const today = businessDateKey(now);
  let firstDay = today;
  if (period === "week") {
    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    firstDay = shiftDateKey(today, -((weekday + 6) % 7));
  }
  if (period === "month") firstDay = `${today.slice(0, 7)}-01`;
  const from = parseBusinessDate(firstDay)!;
  return { from, now };
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const params = new URL(request.url).searchParams;
    const previewMode = Boolean(user.actingAs);
    if (user.role === UserRole.ADMIN) await ensureCoreBranches();
    await ensureCommercialCard();
    await ensureEfectivizacionBanks();
    const canAttend = user.role === UserRole.WORKER || user.role === UserRole.MANAGER;
    const canSelectWaitingTicket = user.role === UserRole.MANAGER && Boolean(user.branchId);
    const workerPresence = canAttend
      ? await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() }, select: { availability: true, moduleNumber: true } })
      : null;
    const period = ["today", "week", "month"].includes(params.get("period") || "") ? params.get("period")! : "today";
    let { from, now } = getRange(period);
    const customFrom = params.get("from");
    const customTo = params.get("to");
    if (customFrom) {
      const parsedFrom = parseBusinessDate(customFrom);
      const parsedTo = parseBusinessDate(customTo || customFrom, true);
      if (parsedFrom && parsedTo && parsedFrom <= parsedTo) {
        from = parsedFrom;
        now = parsedTo;
      }
    }
    const requestedBranch = Number(params.get("branchId") || 0);
    const branchId = user.role === UserRole.ADMIN ? requestedBranch || undefined : user.branchId || -1;
    const workerId = Number(params.get("workerId") || 0) || undefined;
    const serviceId = Number(params.get("serviceId") || 0) || undefined;
    const isIndividualWorker = user.role === UserRole.WORKER;
    const scope: Prisma.TicketWhereInput = {
      ...(branchId ? { branchId } : {}),
      ...(isIndividualWorker ? { assignedToId: user.id } : workerId ? { assignedToId: workerId } : {}),
      ...(serviceId ? { serviceId } : {}),
    };
    const liveQueueScope: Prisma.TicketWhereInput = user.role === UserRole.ADMIN
      ? (branchId ? { branchId } : {})
      : { branchId: user.branchId ?? -1 };
    const historical = { ...scope, arrivedAt: { gte: from, lte: now } };
    const todayStart = getRange("today").from;
    const [waiting, inService, tickets, branches, services, banks, workers, activeTickets, workerHistory, advisorActiveTickets, advisorCompletedToday, userBranch, liveTickets] = await Promise.all([
      prisma.ticket.count({ where: { ...scope, status: TicketStatus.WAITING } }),
      prisma.ticket.count({ where: { ...scope, status: TicketStatus.IN_SERVICE } }),
      prisma.ticket.findMany({ where: historical, include: { service: true, branch: { select: { id: true, name: true } }, assignedTo: { select: { name: true } }, operations: { include: { service: true, bank: { select: { name: true } } } } }, orderBy: { arrivedAt: "desc" } }),
      user.role === UserRole.ADMIN ? prisma.branch.findMany({ orderBy: { name: "asc" } }) : Promise.resolve([]),
      prisma.service.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.bank.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.user.findMany({ where: { active: true, role: { in: [UserRole.WORKER, UserRole.MANAGER] }, ...(branchId ? { branchId } : {}) }, select: { id: true, name: true, username: true, role: true, moduleNumber: true, availability: true, lastActiveAt: true, branch: { select: { name: true } }, services: { include: { service: true } } }, orderBy: { name: "asc" } }),
      canAttend ? prisma.ticket.findMany({ where: { assignedToId: user.id, status: { in: [TicketStatus.CALLED, TicketStatus.IN_SERVICE] } }, include: { service: true }, orderBy: { arrivedAt: "asc" } }) : Promise.resolve([]),
      canAttend
        ? prisma.ticket.findMany({
            where: { assignedToId: user.id, status: { in: [TicketStatus.COMPLETED, TicketStatus.FAILED, TicketStatus.CANCELLED] }, completedAt: { gte: todayStart, lte: new Date() } },
            include: {
              service: true,
              operations: { include: { service: true, bank: { select: { id: true, name: true } } }, orderBy: { id: "asc" } },
              history: { orderBy: { at: "asc" }, include: { actor: { select: { name: true } } } },
            },
            orderBy: { completedAt: "desc" },
          })
        : Promise.resolve([]),
      canAttend && user.branchId
        ? prisma.ticket.findMany({ where: { branchId: user.branchId, status: { in: [TicketStatus.CALLED, TicketStatus.IN_SERVICE] } }, select: { assignedToId: true } })
        : Promise.resolve([]),
      canAttend && user.branchId
        ? prisma.ticket.findMany({ where: { branchId: user.branchId, status: TicketStatus.COMPLETED, completedAt: { gte: todayStart, lte: now } }, select: { assignedToId: true } })
        : Promise.resolve([]),
      user.branchId ? prisma.branch.findUnique({ where: { id: user.branchId }, select: { name: true } }) : Promise.resolve(null),
      prisma.ticket.findMany({ where: { ...liveQueueScope, status: { in: [TicketStatus.WAITING, TicketStatus.CALLED, TicketStatus.IN_SERVICE] } }, include: { service: true, branch: { select: { id: true, name: true } }, assignedTo: { select: { name: true, moduleNumber: true } } } }),
    ]);
    const sortedLiveTickets = sortTicketsForCall(liveTickets);
    // The worker home is a daily personal view. Count attentions by their
    // completion date, and bank activity by the date each operation was saved.
    const workerTodayOperations = isIndividualWorker
      ? await prisma.operation.findMany({
          where: { createdAt: { gte: todayStart, lte: new Date() }, ticket: { assignedToId: user.id, status: TicketStatus.COMPLETED } },
          include: { service: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const advisorPresence = canAttend ? workers.map((worker) => {
      const activeCount = advisorActiveTickets.filter((ticket) => ticket.assignedToId === worker.id).length;
      const online = isRecentlyActive(worker.lastActiveAt);
      const status = activeCount ? "OCCUPIED" : worker.moduleNumber && worker.availability === "AVAILABLE" && online ? "FREE" : "UNAVAILABLE";
      return {
        id: worker.id,
        name: worker.name,
        moduleNumber: worker.moduleNumber,
        status,
        attentionsToday: advisorCompletedToday.filter((ticket) => ticket.assignedToId === worker.id).length,
      };
    }) : [];
    const branchLargeRoom = canAttend && user.branchId
      ? await prisma.largeRoom.findUnique({ where: { branchId: user.branchId }, include: { branch: { select: { name: true } }, worker: { select: { name: true } } } })
      : null;
    const advisorPresenceWithRoom = advisorPresence.map((advisor) => ({
      ...advisor,
      inLargeRoom: Boolean(branchLargeRoom?.active && branchLargeRoom.workerId === advisor.id),
    }));
    const largeRoom = branchLargeRoom ? {
      branchName: branchLargeRoom.branch.name,
      active: branchLargeRoom.active,
      isMine: branchLargeRoom.active && branchLargeRoom.workerId === user.id,
      advisorName: branchLargeRoom.worker?.name || null,
      activeCount: branchLargeRoom.active ? activeTickets.filter((ticket) => ticket.largeRoomId === branchLargeRoom.id).length : 0,
    } : null;
    const completed = tickets.filter(ticket => ticket.status === TicketStatus.COMPLETED);
    const failed = tickets.filter(ticket => ticket.status === TicketStatus.FAILED);
    const operations = completed.flatMap(ticket => ticket.operations);
    // A failed ticket also receives completedAt, but it is not a completed
    // customer service and must not affect service duration averages.
    const waits = completed.filter(ticket => ticket.startedAt).map(ticket => (ticket.startedAt!.getTime() - ticket.arrivedAt.getTime()) / 60000);
    const attentions = completed.filter(ticket => ticket.startedAt && ticket.completedAt).map(ticket => (ticket.completedAt!.getTime() - ticket.startedAt!.getTime()) / 60000);
    const commercial = ["Efectivización", "Pago de deuda"].map(name => {
      const rows = operations.filter(operation => operation.service.name === name);
      return { name, tickets: new Set(rows.map(row => row.ticketId)).size, operations: rows.length, volume: volume(rows), profit: utility(rows) };
    });
    const bankGroups = new Map<string, { bank: string; service: string; commercialChannel: string | null; operations: typeof operations }>();
    operations.forEach((operation) => {
      const bankName = operation.bank?.name || "Sin banco";
      const commercialChannel = operation.commercialChannel || null;
      const key = `${operation.service.name}::${bankName}::${commercialChannel || ""}`;
      const group = bankGroups.get(key) || { bank: bankName, service: operation.service.name, commercialChannel, operations: [] };
      group.operations.push(operation);
      bankGroups.set(key, group);
    });
    const bankPerformance = Array.from(bankGroups.values()).map((group) => ({
      bank: group.bank,
      service: group.service,
      commercialChannel: group.commercialChannel,
      operations: group.operations.length,
      volume: volume(group.operations),
      profit: utility(group.operations),
    })).sort((a, b) => b.volume - a.volume);
    const cancelled = tickets.filter(ticket => ticket.status === TicketStatus.CANCELLED);
    const incompleteByService = services.map((service) => ({
      name: service.name,
      failed: failed.filter(ticket => ticket.serviceId === service.id).length,
      cancelled: cancelled.filter(ticket => ticket.serviceId === service.id).length,
    })).filter((item) => item.failed || item.cancelled);
    const hourlyLabels = Array.from({ length: 10 }, (_, index) => `${String(index + 9).padStart(2, "0")}:00`);
    const hourlyDemand = [...hourlyLabels.map((label) => ({ label, tickets: 0 })), { label: "Fuera de horario", tickets: 0 }];
    tickets.forEach((ticket) => {
      const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(ticket.arrivedAt));
      const index = hour >= 9 && hour < 19 ? hour - 9 : hourlyDemand.length - 1;
      hourlyDemand[index].tickets += 1;
    });
    const branchGroups = new Map<number, typeof tickets>();
    tickets.forEach((ticket) => {
      const group = branchGroups.get(ticket.branchId) || [];
      group.push(ticket);
      branchGroups.set(ticket.branchId, group);
    });
    const groupedBranchPerformance = Array.from(branchGroups.entries()).map(([id, rows]) => {
      const branchCompleted = rows.filter(ticket => ticket.status === TicketStatus.COMPLETED);
      const branchFailed = rows.filter(ticket => ticket.status === TicketStatus.FAILED);
      const branchCancelled = rows.filter(ticket => ticket.status === TicketStatus.CANCELLED);
      const branchOperations = branchCompleted.flatMap(ticket => ticket.operations);
      const branchWaits = branchCompleted.filter(ticket => ticket.startedAt).map(ticket => (ticket.startedAt!.getTime() - ticket.arrivedAt.getTime()) / 60000);
      const branchAttentions = branchCompleted.filter(ticket => ticket.startedAt && ticket.completedAt).map(ticket => (ticket.completedAt!.getTime() - ticket.startedAt!.getTime()) / 60000);
      return { id, name: rows[0].branch.name, received: rows.length, completed: branchCompleted.length, failed: branchFailed.length, cancelled: branchCancelled.length, volume: volume(branchOperations), profit: utility(branchOperations), avgWait: average(branchWaits), avgAttention: average(branchAttentions) };
    });
    const branchPerformance = user.role === UserRole.ADMIN
      ? branches.map((branch) => groupedBranchPerformance.find((item) => item.id === branch.id) || { id: branch.id, name: branch.name, received: 0, completed: 0, failed: 0, cancelled: 0, volume: 0, profit: 0, avgWait: 0, avgAttention: 0 }).sort((a, b) => a.name.localeCompare(b.name, "es"))
      : groupedBranchPerformance.sort((a, b) => a.name.localeCompare(b.name, "es"));
    // This value is intentionally calculated against the whole team, not against
    // the worker's own completed/failed tickets.  It lets the percentages in the
    // table represent the distribution of completed attentions and add up to 100%.
    const totalCompletedAttentions = tickets.filter(ticket => ticket.status === TicketStatus.COMPLETED && ticket.assignedToId !== null).length;
    const workerPerformance = workers.map(worker => {
      const own = tickets.filter(ticket => ticket.assignedToId === worker.id);
      const ownCompleted = own.filter(ticket => ticket.status === TicketStatus.COMPLETED);
      const ownOperations = ownCompleted.flatMap(ticket => ticket.operations);
      const ownVolume = volume(ownOperations), ownUtility = utility(ownOperations);
      const ownWait = ownCompleted.filter(ticket => ticket.startedAt).map(ticket => (ticket.startedAt!.getTime() - ticket.arrivedAt.getTime()) / 60000);
      const ownAttention = ownCompleted.filter(ticket => ticket.startedAt && ticket.completedAt).map(ticket => (ticket.completedAt!.getTime() - ticket.startedAt!.getTime()) / 60000);
      return { ...worker,  attentions: ownCompleted.length, failed: own.filter(ticket => ticket.status === TicketStatus.FAILED).length, operations: ownOperations.length, volume: ownVolume, profit: ownUtility, attendanceShare: totalCompletedAttentions ? ownCompleted.length / totalCompletedAttentions * 100 : 0, avgTicket: ownCompleted.length ? ownVolume / ownCompleted.length : 0, avgProfit: ownCompleted.length ? ownUtility / ownCompleted.length : 0, avgWait: average(ownWait), avgAttention: average(ownAttention) };
    });
    const servicesDistribution = services.map(service => {
      const own = tickets.filter(ticket => ticket.serviceId === service.id);
      const ownOperations = own.filter(ticket => ticket.status === TicketStatus.COMPLETED).flatMap(ticket => ticket.operations);
      return { name: service.name, count: own.length, percentage: tickets.length ? own.length / tickets.length * 100 : 0, volume: volume(ownOperations), profit: utility(ownOperations) };
    });
    const consultations = tickets.filter(ticket => ticket.service.name === "Consulta");
    const successfulConsultations = consultations.filter(ticket => ticket.status === TicketStatus.COMPLETED);
    const conversions = { consultations: consultations.length, toRegistration: successfulConsultations.filter(ticket => ticket.notes?.includes("[escalado:REGISTRO]")).length, toEfectivizacion: successfulConsultations.filter(ticket => ticket.notes?.includes("[escalado:EFECTIVIZACION]")).length, toDebt: successfulConsultations.filter(ticket => ticket.notes?.includes("[escalado:PAGO_DEUDA]")).length };
    // A complete, chronological series shows arrivals and average wait by hour
    // today, and by day for the week/month.
    const trendStarts: Date[] = [];
    const trendByHour = (period === "today" && !customFrom)
      || (Boolean(customFrom) && businessDateKey(from) === businessDateKey(now));
    if (trendByHour) {
      // Jornada de atención de la sede: 9 a. m. a 7 p. m.
      const trendDay = businessDateKey(from);
      for (let minutes = 9 * 60; minutes < 19 * 60; minutes += 60) {
        const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
        const minute = String(minutes % 60).padStart(2, "0");
        trendStarts.push(new Date(`${trendDay}T${hour}:${minute}:00-05:00`));
      }
    } else {
      const firstDay = businessDateKey(from);
      const lastDay = businessDateKey(now);
      for (let day = firstDay; day <= lastDay; day = shiftDateKey(day, 1)) {
        trendStarts.push(parseBusinessDate(day)!);
      }
    }
    const trend = trendStarts.map((start) => {
      const end = new Date(start.getTime() + (trendByHour ? 60 : 24 * 60) * 60 * 1000);
      const rows = tickets.filter(ticket => ticket.arrivedAt >= start && ticket.arrivedAt < end);
      const label = trendByHour
        ? new Intl.DateTimeFormat("es-PE", { timeZone: BUSINESS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(start)
        : period === "week"
          ? start.toLocaleDateString("es-PE", { timeZone: BUSINESS_TIME_ZONE, weekday: "short" }).replace(".", "")
          : start.toLocaleDateString("es-PE", { timeZone: BUSINESS_TIME_ZONE, day: "2-digit", month: "short" });
      const waitTimes = rows.flatMap(ticket => {
        const waitEnd = ticket.startedAt || ((ticket.status === TicketStatus.WAITING || ticket.status === TicketStatus.CALLED) ? now : null);
        return waitEnd ? [(waitEnd.getTime() - ticket.arrivedAt.getTime()) / 60000] : [];
      });
      const completedRows = rows.filter(ticket => ticket.status === TicketStatus.COMPLETED);
      const attentionTimes = completedRows.flatMap(ticket => ticket.startedAt && ticket.completedAt ? [(ticket.completedAt.getTime() - ticket.startedAt.getTime()) / 60000] : []);
      return { label, tickets: rows.length, completed: completedRows.length, avgWait: average(waitTimes), avgAttention: average(attentionTimes) };
    });
    const recurringClients = new Map<string, number>();
    tickets.forEach(ticket => recurringClients.set(ticket.dni, (recurringClients.get(ticket.dni) || 0) + 1));
    const quality = {
      failed: failed.length,
      cancelled: cancelled.length,
      incomplete: failed.length + cancelled.length,
      failedRate: completed.length + failed.length ? failed.length / (completed.length + failed.length) * 100 : 0,
      escalated: tickets.filter(ticket => ticket.notes?.includes("[escalado:")).length,
      recurringClients: Array.from(recurringClients.values()).filter(count => count > 1).length,
    };
    const totalAmount = volume(operations), totalProfit = utility(operations);
    const personalDayHistory = workerHistory.filter((ticket) => ticket.status === TicketStatus.COMPLETED || ticket.status === TicketStatus.FAILED || ticket.status === TicketStatus.CANCELLED);
    const personalDayCompleted = personalDayHistory.filter((ticket) => ticket.status === TicketStatus.COMPLETED).length;
    const personalDayFailed = personalDayHistory.filter((ticket) => ticket.status === TicketStatus.FAILED).length;
    const personalDayCancelled = personalDayHistory.filter((ticket) => ticket.status === TicketStatus.CANCELLED).length;
    const personalDayVolume = volume(workerTodayOperations);
    const personalDayProfit = utility(workerTodayOperations);
    const adminPreviewWorkers = user.role === UserRole.ADMIN || (previewMode && Boolean(user.adminId))
      ? await (async () => {
          const [workers, roster] = await Promise.all([
            prisma.user.findMany({ where: { active: true, role: { in: [UserRole.WORKER, UserRole.MANAGER] } }, select: { id: true, name: true, username: true, dni: true, role: true, moduleNumber: true, branch: { select: { name: true } } }, orderBy: { name: "asc" } }),
            registrosATKUserRoster(),
          ]);
          return workers.filter((worker) => {
            const identities = [worker.username, worker.name, worker.dni].filter(Boolean).map((value) => value!.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^@+/, ""));
            if (roster.activeUsernames) return identities.some((identity) => roster.activeUsernames!.has(identity));
            return false;
          });
        })()
      : undefined;
    // Keep each advisor's own completed count in the team roster. Personal dashboard
    // metrics remain scoped to the signed-in worker; this is only the shared roster.
    const visibleAdvisorPresence = advisorPresenceWithRoom;
    return Response.json({ user: { id: user.id, name: user.name, role: user.role, branchId: user.branchId, branchName: userBranch?.name || null, canSelectWaitingTicket, availability: workerPresence?.availability || null, moduleNumber: workerPresence?.moduleNumber || null }, selectedBranchId: user.role === UserRole.ADMIN ? branchId ?? null : null, previewMode, adminPreviewWorkers, largeRoom, advisorPresence: visibleAdvisorPresence, period, range: { from, to: now }, activeTicket: activeTickets[0] || null, activeTickets, liveTickets: sortedLiveTickets, workerHistory, workerTodayOperations: workerTodayOperations.map((operation) => ({ id: operation.id, amount: operation.amount, profit: operation.profit, createdAt: operation.createdAt, service: operation.service })), branches, services, banks, workers: isIndividualWorker ? workers.filter((worker) => worker.id === user.id) : workers, stats: { waiting, inService, completed: isIndividualWorker ? personalDayCompleted : completed.length, failed: isIndividualWorker ? personalDayFailed : failed.length, cancelled: isIndividualWorker ? personalDayCancelled : cancelled.length, totalAmount: isIndividualWorker ? personalDayVolume : totalAmount, totalProfit: isIndividualWorker ? personalDayProfit : totalProfit, totalTickets: isIndividualWorker ? waiting + inService + personalDayHistory.length : tickets.length, ownToday: isIndividualWorker ? personalDayCompleted : tickets.filter(ticket => ticket.assignedToId === user.id && ticket.status === TicketStatus.COMPLETED).length, avgTicket: completed.length ? totalAmount / completed.length : 0, avgProfit: completed.length ? totalProfit / completed.length : 0, avgWait: average(waits), avgAttention: average(attentions) }, workerPerformance: isIndividualWorker ? workerPerformance.filter((worker) => worker.id === user.id) : workerPerformance, servicesDistribution, commercial, bankPerformance, incompleteByService, hourlyDemand, branchPerformance, conversions, trend, quality });
  } catch (error) { return errorResponse(error); }
}

