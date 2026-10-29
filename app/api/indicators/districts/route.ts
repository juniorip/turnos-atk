import { Prisma, UserRole } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { ensureCoreBranches } from "@/lib/branches";
import { LIMA_DISTRICTS } from "@/lib/lima-districts";
import { prisma } from "@/lib/prisma";
import { ensureTicketDistrictSchema } from "@/lib/ticket-district-schema";

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
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    first = date.toISOString().slice(0, 10);
  } else if (period === "month") first = `${today.slice(0, 7)}-01`;
  return { from: parseDate(first)!, to: now };
}

export async function GET(request: Request) {
  try {
    await requireUser(UserRole.ADMIN);
    await Promise.all([ensureCoreBranches(), ensureTicketDistrictSchema()]);
    const params = new URL(request.url).searchParams;
    const period = params.get("period") || "today";
    const from = parseDate(params.get("from"));
    const to = parseDate(params.get("to"), true);
    const range = from ? { from, to: to || parseDate(params.get("from"), true)! } : defaultRange(period);
    if (range.from > range.to) return Response.json({ error: "El rango de fechas no es válido." }, { status: 400 });
    const dateFilter: Prisma.DateTimeFilter = { gte: range.from, lte: range.to };
    const branches = await prisma.branch.findMany({ where: { code: { in: ["LIN", "SUR", "NOR"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    const tickets = await prisma.ticket.findMany({ where: { arrivedAt: dateFilter, branchId: { in: branches.map((branch) => branch.id) } }, select: { branchId: true, district: true } });
    const countByDistrict = (rows: { district: string | null }[]) => {
      const counts = new Map<string, number>();
      for (const district of LIMA_DISTRICTS) counts.set(district, 0);
      for (const ticket of rows) if (ticket.district && counts.has(ticket.district)) counts.set(ticket.district, (counts.get(ticket.district) || 0) + 1);
      const reported = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);
      const ranked = Array.from(counts, ([district, count]) => ({ district, count, percentage: reported ? count / reported * 100 : 0 }))
        .filter((item) => item.count > 0)
        .sort((a, b) => b.count - a.count || a.district.localeCompare(b.district, "es"));
      return { reported, ranked };
    };
    const overall = countByDistrict(tickets);
    const byBranch = branches.map((branch) => {
      const branchTickets = tickets.filter((ticket) => ticket.branchId === branch.id);
      const counts = countByDistrict(branchTickets);
      const top = counts.ranked[0];
      return {
        branchId: branch.id,
        branchName: branch.name,
        total: branchTickets.length,
        reported: counts.reported,
        withoutDistrict: branchTickets.length - counts.reported,
        topDistrict: top?.district || null,
        topCount: top?.count || 0,
        topPercentage: top?.percentage || 0,
        districts: counts.ranked,
      };
    });
    return Response.json({
      range: { from: range.from, to: range.to },
      total: tickets.length,
      reported: overall.reported,
      withoutDistrict: tickets.length - overall.reported,
      districts: overall.ranked,
      branches: byBranch,
    });
  } catch (error) { return errorResponse(error); }
}
