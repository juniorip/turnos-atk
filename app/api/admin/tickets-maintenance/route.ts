import { createHash } from "node:crypto";
import { UserRole, type Prisma, type PrismaClient } from "@prisma/client";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const ticketInclude = {
  branch: true,
  service: true,
  assignedTo: { select: { id: true, name: true, username: true, role: true, branchId: true, moduleNumber: true } },
  createdBy: { select: { id: true, name: true, username: true, role: true, branchId: true } },
  history: {
    orderBy: { id: "asc" },
    include: { actor: { select: { id: true, name: true, username: true } } },
  },
  operations: {
    orderBy: { id: "asc" },
    include: { service: true, bank: true },
  },
} satisfies Prisma.TicketInclude;

async function readTickets(db: PrismaClient | Prisma.TransactionClient) {
  return db.ticket.findMany({ where: {}, orderBy: { id: "asc" }, include: ticketInclude });
}

function hashTickets(tickets: Awaited<ReturnType<typeof readTickets>>) {
  return createHash("sha256").update(JSON.stringify(tickets)).digest("hex");
}

export async function GET() {
  try {
    await requireUser(UserRole.ADMIN);
    const generatedAt = new Date().toISOString();
    const tickets = await readTickets(prisma);
    const backupHash = hashTickets(tickets);
    const archive = {
      format: "turnos-atk-ticket-backup-v1",
      generatedAt,
      backupHash,
      ticketCount: tickets.length,
      tickets,
    };
    const filename = `turnos-atk-respaldo-tickets-${generatedAt.slice(0, 10)}.json`;
    return new Response(JSON.stringify(archive, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, private",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireUser(UserRole.ADMIN);
    const parsed = z.object({
      confirmation: z.literal("BORRAR_TODOS_LOS_TICKETS"),
      backupHash: z.string().regex(/^[a-f0-9]{64}$/),
    }).safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Confirmación o respaldo inválido." }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      // Coordinate with ticket creation and claiming, which use the same branch locks.
      const branches = await tx.branch.findMany({ select: { id: true }, orderBy: { id: "asc" } });
      for (const branch of branches) await tx.$queryRaw`SELECT pg_advisory_xact_lock(${branch.id})::text`;

      const tickets = await readTickets(tx);
      if (hashTickets(tickets) !== parsed.data.backupHash) return { changed: true } as const;

      await tx.operation.deleteMany({});
      await tx.ticketHistory.deleteMany({});
      const deleted = await tx.ticket.deleteMany({});
      return { deleted: deleted.count } as const;
    }, { isolationLevel: "ReadCommitted", timeout: 60_000 });

    if ("changed" in result) return Response.json({ error: "Los tickets cambiaron desde el respaldo. Descarga una copia nueva antes de reiniciar." }, { status: 409 });
    return Response.json({ ok: true, deleted: result.deleted, historyDeleted: true, operationsDeleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
