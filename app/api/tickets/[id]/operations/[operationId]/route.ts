import { TicketStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { COMMISSION_PLANS, debtCommission, effectivizacionCommission, SETTLEMENT_TIMINGS } from "@/lib/effectivizacion";
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

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; operationId: string }> }) {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER, UserRole.ADMIN);
    const { id: rawTicketId, operationId: rawOperationId } = await params;
    const ticketId = Number(rawTicketId);
    const operationId = Number(rawOperationId);
    if (!Number.isSafeInteger(ticketId) || ticketId <= 0 || !Number.isSafeInteger(operationId) || operationId <= 0) {
      return Response.json({ error: "Ticket u operación inválidos." }, { status: 400 });
    }

    const parsed = operationSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Revisa el tipo, banco, monto y comisión de la operación." }, { status: 400 });
    const item = parsed.data;
    const scope = user.role === UserRole.WORKER
      ? { assignedToId: user.id, branchId: user.branchId ?? -1 }
      : user.role === UserRole.MANAGER ? { branchId: user.branchId ?? -1 } : {};

    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findFirst({ where: { id: ticketId, status: TicketStatus.COMPLETED, ...scope }, select: { id: true } });
      if (!ticket) return { error: "Solo puedes editar operaciones de tickets finalizados dentro de tu ámbito de acceso.", status: 409 } as const;
      const operation = await tx.operation.findFirst({ where: { id: operationId, ticketId }, select: { id: true } });
      if (!operation) return { error: "No se encontró esa operación en el ticket.", status: 404 } as const;

      const allowedBanks = banksByService[item.serviceName] as readonly string[];
      const bank = await tx.bank.findFirst({ where: { id: item.bankId, active: true, name: { in: [...allowedBanks] } } });
      if (!bank) return { error: `El banco no está habilitado para ${item.serviceName}.`, status: 400 } as const;
      const service = await tx.service.findUnique({ where: { name: item.serviceName } });
      if (!service) return { error: `No se encontró el trámite ${item.serviceName}.`, status: 400 } as const;

      let rate: number;
      let profit: number;
      if (item.serviceName === "Efectivización") {
        if (!item.commissionPlan) return { error: "Selecciona un plan de comisión para Efectivización.", status: 400 } as const;
        if (item.commissionPlan.startsWith("INTERBANK_") !== (bank.name === "Interbank")) {
          return { error: "El plan de comisión no corresponde al banco seleccionado.", status: 400 } as const;
        }
        const commission = effectivizacionCommission(bank.name, item.amount, item.commissionPlan, item.settlementTiming);
        rate = commission.rate;
        profit = commission.profit;
      } else {
        if (!item.debtRate) return { error: "Selecciona la comisión de Pago de deuda.", status: 400 } as const;
        rate = item.debtRate;
        profit = debtCommission(item.amount, rate);
      }

      const isCommercialCard = bank.name === "Tarjeta Comercial" && item.serviceName === "Efectivización";
      if (!isCommercialCard && item.commercialChannel) {
        return { error: "El canal POS o Link de pago solo aplica a Efectivización con Tarjeta Comercial.", status: 400 } as const;
      }
      return tx.operation.update({
        where: { id: operationId },
        data: {
          serviceId: service.id,
          bankId: bank.id,
          commercialChannel: isCommercialCard ? item.commercialChannel || "POS" : null,
          amount: Math.max(0, item.amount - profit),
          rate,
          profit,
        },
        include: { service: true, bank: { select: { id: true, name: true } } },
      });
    });

    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ operation: result });
  } catch (error) {
    return errorResponse(error);
  }
}
