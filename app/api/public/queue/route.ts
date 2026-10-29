import { TicketStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sortTicketsForCall } from "@/lib/queue-order";
import { canonicalBranchCode, ensureCoreBranches } from "@/lib/branches";

function displayName(clientName: string) {
  // La base actual guarda muchos nombres como "APELLIDO APELLIDO, NOMBRES".
  // La TV muestra solo el primer nombre y primer apellido, nunca el DNI.
  const [lastNames, firstNames] = clientName.split(",");
  if (firstNames) return `${firstNames.trim().split(/\s+/)[0]} ${lastNames.trim().split(/\s+/)[0]}`;
  const parts = clientName.trim().split(/\s+/);
  return [parts[0], parts[1]].filter(Boolean).join(" ");
}


// Pantalla pública de sala de espera: no expone DNI ni nombres completos.
export async function GET(request: Request) {
  const requestedCode = new URL(request.url).searchParams.get("code")?.trim();
  if (!requestedCode) return Response.json({ error: "Sede invalida." }, { status: 400 });
  const code = canonicalBranchCode(requestedCode);

  await ensureCoreBranches();

  const branch = await prisma.branch.findFirst({
    where: { code, active: true },
    select: { id: true, name: true, code: true },
  });
  if (!branch) return Response.json({ error: "Esta sede no esta disponible." }, { status: 404 });

  const [calling, waitingCount, waitingTickets, recentlyCompleted] = await Promise.all([
    prisma.ticket.findMany({
      where: { branchId: branch.id, status: TicketStatus.CALLED },
      select: {
        code: true, isPreferential: true,
        clientName: true,
        startedAt: true,
        service: { select: { name: true } },
        assignedTo: { select: { moduleNumber: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 3,
    }),
    prisma.ticket.count({ where: { branchId: branch.id, status: TicketStatus.WAITING } }),
    prisma.ticket.findMany({
      where: { branchId: branch.id, status: TicketStatus.WAITING },
      select: { id: true, arrivedAt: true, code: true, isPreferential: true, clientName: true, service: { select: { name: true } } },
    }),
    prisma.ticket.findMany({
      where: { branchId: branch.id, status: TicketStatus.COMPLETED },
      select: { code: true, isPreferential: true, completedAt: true },
      orderBy: { completedAt: "desc" },
      take: 5,
    }),
  ]);
  const nextTickets = sortTicketsForCall(waitingTickets).slice(0, 5);

  return Response.json({
    branch,
    calling: calling.map((ticket) => ({
      code: ticket.code,
      isPreferential: ticket.isPreferential,
      startedAt: ticket.startedAt,
      service: ticket.service,
      displayName: displayName(ticket.clientName),
      module: ticket.assignedTo?.moduleNumber || null,
    })),
    waitingCount,
    nextTickets: nextTickets.map((ticket) => ({
      code: ticket.code,
      isPreferential: ticket.isPreferential,
      service: ticket.service,
      displayName: displayName(ticket.clientName),
    })),
    recentlyCompleted,
  });
}
