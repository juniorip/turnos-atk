import { Prisma, TicketStatus, UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureCoreBranches } from "@/lib/branches";

const timeZone = "America/Lima";

function dateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDate(value: string | null, end = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const check = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== value) return null;
  return new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}-05:00`);
}

function defaultRange(period: string) {
  const now = new Date();
  const today = dateKey(now);
  let first = today;
  if (period === "week") {
    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    const start = new Date(`${today}T00:00:00.000Z`);
    start.setUTCDate(start.getUTCDate() - ((weekday + 6) % 7));
    first = start.toISOString().slice(0, 10);
  } else if (period === "month") first = `${today.slice(0, 7)}-01`;
  return { from: parseDate(first)!, to: now };
}

export async function GET(request: Request) {
  try {
    await requireUser(UserRole.ADMIN);
    await ensureCoreBranches();
    const params = new URL(request.url).searchParams;
    const period = params.get("period") || "today";
    const from = parseDate(params.get("from"));
    const to = parseDate(params.get("to"), true);
    const range = from ? { from, to: to || parseDate(params.get("from"), true)! } : defaultRange(period);
    if (range.from > range.to) return Response.json({ error: "El rango de fechas no es válido." }, { status: 400 });
    const dateFilter: Prisma.DateTimeFilter = { gte: range.from, lte: range.to };

    const [branches, receivedTickets, closedTickets, operations] = await Promise.all([
      prisma.branch.findMany({ where: { code: { in: ["LIN", "SUR", "NOR"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.ticket.findMany({ where: { arrivedAt: dateFilter }, select: { branchId: true } }),
      prisma.ticket.findMany({
        where: { completedAt: dateFilter, status: { in: [TicketStatus.COMPLETED, TicketStatus.FAILED, TicketStatus.CANCELLED] } },
        select: { branchId: true, status: true },
      }),
      prisma.operation.findMany({
        where: { createdAt: dateFilter, ticket: { status: TicketStatus.COMPLETED } },
        include: {
          bank: { select: { name: true } },
          service: { select: { name: true } },
          ticket: { select: { branchId: true, branch: { select: { name: true } } } },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const rows = branches.map((branch) => ({
      branchId: branch.id, branchName: branch.name,
      received: receivedTickets.filter((ticket) => ticket.branchId === branch.id).length,
      completed: closedTickets.filter((ticket) => ticket.branchId === branch.id && ticket.status === TicketStatus.COMPLETED).length,
      failed: closedTickets.filter((ticket) => ticket.branchId === branch.id && ticket.status === TicketStatus.FAILED).length,
      cancelled: closedTickets.filter((ticket) => ticket.branchId === branch.id && ticket.status === TicketStatus.CANCELLED).length,
      operations: 0, volume: 0, netVolume: 0, profit: 0,
    }));
    const rowById = new Map(rows.map((row) => [row.branchId, row]));
    const serviceMap = new Map<string, { branchId: number; branchName: string; service: string; operations: number; tickets: Set<number>; volume: number; netVolume: number; profit: number }>();
    const bankMap = new Map<string, { branchId: number; branchName: string; service: string; bank: string; commercialChannel: string | null; operations: number; volume: number; netVolume: number; profit: number }>();
    const startKey = dateKey(range.from);
    const endKey = dateKey(range.to);
    const hourly = startKey === endKey;
    const trendMap = new Map<string, Map<number, { operations: number; profit: number }>>();
    if (hourly) {
      for (let hour = 9; hour < 19; hour++) trendMap.set(`${String(hour).padStart(2, "0")}:00`, new Map());
      trendMap.set("Fuera de horario", new Map());
    } else {
      const first = new Date(`${startKey}T00:00:00.000Z`);
      const last = new Date(`${endKey}T00:00:00.000Z`);
      for (const cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const key = cursor.toISOString().slice(0, 10);
        trendMap.set(key, new Map());
      }
    }

    for (const operation of operations) {
      const branchId = operation.ticket.branchId;
      const branchName = operation.ticket.branch.name;
      const row = rowById.get(branchId);
      const net = Number(operation.amount);
      const profit = Number(operation.profit);
      const gross = net + profit;
      if (row) {
        row.operations += 1;
        row.volume += gross;
        row.netVolume += net;
        row.profit += profit;
      }
      const serviceKey = `${branchId}:${operation.service.name}`;
      const serviceRow = serviceMap.get(serviceKey) || { branchId, branchName, service: operation.service.name, operations: 0, tickets: new Set<number>(), volume: 0, netVolume: 0, profit: 0 };
      serviceRow.operations += 1;
      serviceRow.tickets.add(operation.ticketId);
      serviceRow.volume += gross;
      serviceRow.netVolume += net;
      serviceRow.profit += profit;
      serviceMap.set(serviceKey, serviceRow);
      const bankName = operation.bank?.name || "Sin banco";
      const commercialChannel = operation.commercialChannel || null;
      const bankKey = `${branchId}:${operation.service.name}:${bankName}:${commercialChannel || ""}`;
      const bankRow = bankMap.get(bankKey) || { branchId, branchName, service: operation.service.name, bank: bankName, commercialChannel, operations: 0, volume: 0, netVolume: 0, profit: 0 };
      bankRow.operations += 1;
      bankRow.volume += gross;
      bankRow.netVolume += net;
      bankRow.profit += profit;
      bankMap.set(bankKey, bankRow);

      let bucket = dateKey(operation.createdAt);
      if (hourly) {
        const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(operation.createdAt));
        bucket = hour >= 9 && hour < 19 ? `${String(hour).padStart(2, "0")}:00` : "Fuera de horario";
      }
      if (!trendMap.has(bucket)) trendMap.set(bucket, new Map());
      const branchTrend = trendMap.get(bucket)!;
      const values = branchTrend.get(branchId) || { operations: 0, profit: 0 };
      values.operations += 1;
      values.profit += profit;
      branchTrend.set(branchId, values);
    }

    const trend = [...trendMap.entries()].map(([label, byBranch]) => ({
      label: hourly || label === "Fuera de horario" ? label : new Intl.DateTimeFormat("es-PE", { timeZone, day: "2-digit", month: "short" }).format(parseDate(label)!).replace(".", ""),
      values: branches.map((branch) => ({ branchId: branch.id, branchName: branch.name, operations: byBranch.get(branch.id)?.operations || 0, profit: byBranch.get(branch.id)?.profit || 0 })),
    }));
    return Response.json({
      range: { from: range.from, to: range.to },
      branches: rows.sort((a, b) => b.profit - a.profit),
      services: [...serviceMap.values()].map(({ tickets, ...item }) => ({ ...item, tickets: tickets.size })).sort((a, b) => a.service.localeCompare(b.service, "es") || a.branchName.localeCompare(b.branchName, "es")),
      banks: [...bankMap.values()].sort((a, b) => b.profit - a.profit),
      trend,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
