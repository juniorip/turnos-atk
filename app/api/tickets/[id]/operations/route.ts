import { TicketStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { COMMISSION_PLANS, effectivizacionCommission, SETTLEMENT_TIMINGS } from "@/lib/effectivizacion";
import { prisma } from "@/lib/prisma";

const operationSchema = z.object({
  serviceName: z.enum(["Efectivización", "Pago de deuda"]),
  bankId: z.number().int().positive(),
  amount: z.number().positive().max(1_000_000),
  commissionPlan: z.enum(COMMISSION_PLANS).optional(),
  settlementTiming: z.enum(SETTLEMENT_TIMINGS).optional(),
  commercialChannel: z.enum(["POS", "PAYMENT_LINK"]).nullable().optional(),
  debtRate: z.number().refine((rate) => [1, 1.5, 2, 2.5].includes(rate)).optional(),
});

const banksByService = {
  Efectivización: ["BCP", "BBVA", "BanBif", "Scotiabank", "Interbank", "CMR", "IO", "Tarjeta Comercial"],
  "Pago de deuda": ["BCP", "BBVA", "BanBif", "Scotiabank", "Interbank"],
} as const;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER, UserRole.ADMIN);
    const id = Number((await params).id);
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Ticket inválido." }, { status: 400 });

    const parsed = z.object({ operations: z.array(operationSchema).min(1).max(20) }).safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Revisa los datos de las operaciones." }, { status: 400 });

    const result = await prisma.$transaction(async (tx) => {
      const accessScope = user.role === UserRole.WORKER
        ? { assignedToId: user.id, branchId: user.branchId ?? -1 }
        : user.role === UserRole.MANAGER ? { branchId: user.branchId ?? -1 } : {};
      const ticket = await tx.ticket.findFirst({
        where: { id, ...accessScope, status: TicketStatus.COMPLETED },
        select: { id: true, branchId: true },
      });
      if (!ticket) return null;

      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${ticket.branchId})::text`;
      const stillCompleted = await tx.ticket.findFirst({
        where: { id, ...accessScope, branchId: ticket.branchId, status: TicketStatus.COMPLETED },
        select: { id: true },
      });
      if (!stillCompleted) return null;

      const prepared: { serviceId: number; bankId: number; commercialChannel: string | null; amount: number; rate: number; profit: number }[] = [];
      for (const item of parsed.data.operations) {
        const allowedBanks = banksByService[item.serviceName] as readonly string[];
        const bank = await tx.bank.findFirst({ where: { id: item.bankId, active: true, name: { in: [...allowedBanks] } } });
        if (!bank) return { error: `El banco no está habilitado para ${item.serviceName}.` } as const;
        const service = await tx.service.findUnique({ where: { name: item.serviceName } });
        if (!service) return { error: `No se encontró el trámite ${item.serviceName}.` } as const;

        let rate: number;
        let profit: number;
        let recordedAmount: number;
        if (item.serviceName === "Efectivización") {
          if (!item.commissionPlan) return { error: "Selecciona un plan de comisión para Efectivización." } as const;
          const isInterbankPlan = item.commissionPlan.startsWith("INTERBANK_");
          if (isInterbankPlan !== (bank.name === "Interbank")) return { error: "El plan de comisión no corresponde al banco seleccionado." } as const;
          const commission = effectivizacionCommission(bank.name, item.amount, item.commissionPlan, item.settlementTiming);
          rate = commission.rate;
          profit = commission.profit;
          recordedAmount = Math.max(0, item.amount - profit);
        } else {
          if (!item.debtRate) return { error: "Selecciona la comisión de Pago de deuda." } as const;
          rate = item.debtRate;
          profit = (item.amount * rate) / 100;
          recordedAmount = Math.max(0, item.amount - profit);
        }

        const isCommercialCard = bank.name === "Tarjeta Comercial" && item.serviceName === "Efectivización";
        if (!isCommercialCard && item.commercialChannel) return { error: "El canal POS o Link de pago solo aplica a Efectivización con Tarjeta Comercial." } as const;
        prepared.push({ serviceId: service.id, bankId: bank.id, commercialChannel: isCommercialCard ? item.commercialChannel || "POS" : null, amount: recordedAmount, rate, profit });
      }

      const created = [];
      for (const item of prepared) {
        created.push(await tx.operation.create({
          data: { ticketId: id, ...item },
          include: { service: true, bank: { select: { id: true, name: true } } },
        }));
      }
      return { created } as const;
    }, { isolationLevel: "ReadCommitted" });

    if (!result) return Response.json({ error: "Solo puedes agregar operaciones a tickets finalizados que estén dentro de tu ámbito de acceso." }, { status: 409 });
    if ("error" in result) return Response.json({ error: result.error }, { status: 400 });
    return Response.json({ operations: result.created });
  } catch (error) {
    return errorResponse(error);
  }
}
