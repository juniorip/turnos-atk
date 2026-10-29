import { TicketStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { errorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  COMMISSION_PLANS,
  effectivizacionCommission,
  SETTLEMENT_TIMINGS,
} from "@/lib/effectivizacion";
import { sendToRegistrosAtK, type EscalationKind } from "@/lib/registros-atk";
const schema = z.object({
  successful: z.boolean(),
  cancelled: z.boolean().default(false),
  escalation: z.enum(["REGISTRO", "CONSULTA", "EFECTIVIZACION", "PAGO_DEUDA"]).nullable().optional(),
  registerClient: z.boolean().default(false),
  uploadPlatform: z.enum(["WEB", "DRIVE"]).default("WEB"),
  operations: z.array(
    z.object({
      bankId: z.number().int().nullable(),
      amount: z.number().positive(),
      serviceName: z.enum(["Efectivización", "Pago de deuda"]).optional(),
      commissionPlan: z.enum(COMMISSION_PLANS).optional(),
      settlementTiming: z.enum(SETTLEMENT_TIMINGS).optional(),
      commercialChannel: z.enum(["POS", "PAYMENT_LINK"]).nullable().optional(),
      debtRate: z.number().min(0).max(100).optional(),
    }),
  ),
}).refine((value) => !(value.successful && value.cancelled), { message: "El ticket no puede completarse y cancelarse a la vez." });
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireUser(UserRole.WORKER, UserRole.MANAGER);
    const id = Number((await params).id);
    const body = schema.safeParse(await request.json());
    if (!body.success)
      return Response.json(
        { error: "Datos de finalización inválidos." },
        { status: 400 },
      );
    if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Ticket inválido." }, { status: 400 });
    if (!body.data.successful && body.data.operations.length) return Response.json({ error: "Una atención no completada no puede guardar operaciones. Finalízala como exitosa si se realizó una operación válida." }, { status: 400 });
    const completed = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findFirst({
        where: { id, assignedToId: user.id, branchId: user.branchId ?? -1, status: TicketStatus.IN_SERVICE },
        include: { service: true, assignedTo: { select: { username: true, dni: true } } },
      });
      if (!ticket) return null;
      const escalation = body.data.successful ? body.data.escalation : null;
      const operationServiceName = escalation === "EFECTIVIZACION"
        ? "Efectivización"
        : escalation === "PAGO_DEUDA"
          ? "Pago de deuda"
          : escalation === "CONSULTA"
            ? "Consulta"
            : escalation === "REGISTRO" ? "Registro" : ticket.service.name;
      const status = body.data.successful ? TicketStatus.COMPLETED : body.data.cancelled ? TicketStatus.CANCELLED : TicketStatus.FAILED;
      // Acquire the right to finish before recording any effects. Concurrent
      // requests re-check the predicate after the PostgreSQL row lock is released.
      const transitioned = await tx.ticket.updateMany({
        where: { id, assignedToId: user.id, branchId: user.branchId ?? -1, status: TicketStatus.IN_SERVICE },
        data: { status, completedAt: new Date(), ...(escalation && escalation !== "CONSULTA" ? { notes: `${ticket.notes || ""}${ticket.notes ? " · " : ""}[escalado:${escalation}]` } : {}) },
      });
      if (!transitioned.count) return null;
      for (const op of body.data.operations) {
        const opServiceName = op.serviceName || operationServiceName;
        const operationService = opServiceName === ticket.service.name
          ? ticket.service
          : await tx.service.findUnique({ where: { name: opServiceName } });
        if (!operationService) throw new Error("No se encontró el trámite de la operación.");
        let rate = 0,
          profit = 0,
          recordedAmount = op.amount,
          commercialChannel: string | null = null;
        if (opServiceName === "Efectivización") {
          if (!op.bankId || !op.commissionPlan)
            throw new Error(
              "En Efectivización debes indicar banco y plan de comisión.",
            );
          const bank = await tx.bank.findUnique({ where: { id: op.bankId } });
          if (!bank) throw new Error("Banco inválido.");
          const isCommercialCard = bank.name === "Tarjeta Comercial";
          if (!isCommercialCard && op.commercialChannel) throw new Error("El canal POS o Link de pago solo aplica a Tarjeta Comercial.");
          if (isCommercialCard) commercialChannel = op.commercialChannel || "POS";
          const calculated = effectivizacionCommission(
            bank.name,
            op.amount,
            op.commissionPlan,
            op.settlementTiming,
          );
          rate = calculated.rate;
          profit = calculated.profit;
          recordedAmount = Math.max(0, op.amount - profit);
        } else if (opServiceName === "Pago de deuda") {
          if (!op.bankId || !op.debtRate)
            throw new Error("En Pago de deuda debes indicar banco y comisión.");
          rate = op.debtRate;
          profit = (op.amount * rate) / 100;
          recordedAmount = Math.max(0, op.amount - profit);
        } else {
          const configured = op.bankId
            ? await tx.rate.findUnique({
                where: {
                  serviceId_bankId: {
                    serviceId: operationService.id,
                    bankId: op.bankId,
                  },
                },
              })
            : null;
          rate = Number(configured?.rate || 0);
          profit = (op.amount * rate) / 100;
        }
        await tx.operation.create({
          data: {
            ticketId: id,
            serviceId: operationService.id,
            bankId: op.bankId,
            commercialChannel,
            amount: recordedAmount,
            rate,
            profit,
          },
        });
      }
      await tx.ticketHistory.create({
        data: { ticketId: id, status, actorId: user.id },
      });
      const result = await tx.ticket.findUniqueOrThrow({
        where: { id },
        include: { operations: { include: { bank: true, service: true }, orderBy: { id: "asc" } }, service: true },
      });
      return { result, source: ticket };
    }, { isolationLevel: "ReadCommitted" });
    if (!completed) return Response.json({ error: "El turno ya no está disponible." }, { status: 409 });
    const ticket = completed.source;
    const escalation = body.data.successful ? body.data.escalation : null;
    // Only a confirmed registration step is synchronized. If this registered
    // ticket also completed effectuation/debt operations, send them as separate
    // OPERACION records alongside the REGISTRO record.
    const shouldSync = body.data.successful && body.data.registerClient;
    const kind: EscalationKind = "REGISTRO";
    const operationServiceName = escalation === "EFECTIVIZACION"
      ? "Efectivización"
      : escalation === "PAGO_DEUDA"
        ? "Pago de deuda"
        : ticket.service.name === "Efectivización" || ticket.service.name === "Pago de deuda"
          ? ticket.service.name
          : null;
    let integration = null;
    if (shouldSync) {
      // A network failure must never turn a committed local success into HTTP 500.
      try {
        integration = await sendToRegistrosAtK({
          ticketId: ticket.id,
          ticketCode: ticket.code,
          workerUsername: ticket.assignedTo?.username || "",
          workerDni: ticket.assignedTo?.dni || null,
          clientName: ticket.clientName,
          dni: ticket.dni,
          kind,
          uploadPlatform: body.data.uploadPlatform,
          notes: completed.result.notes,
          operations: completed.result.operations.length
            ? completed.result.operations.filter((operation) => operation.service.name === "Efectivización" || operation.service.name === "Pago de deuda").map((operation, index) => ({
                serviceName: operation.service.name as "Efectivización" | "Pago de deuda",
                bankName: operation.bank?.name || null,
                amount: body.data.operations[index]?.amount ?? Number(operation.amount) + Number(operation.profit),
                rate: Number(operation.rate),
                profit: Number(operation.profit),
              }))
            : [],
        });
      } catch {
        integration = { synced: false, reason: "El ticket quedó finalizado. No se pudo conectar con Registros ATK; verifica su registro antes de reenviarlo." };
      }
    }
    return Response.json({ ticket: completed.result, integration });
  } catch (e) {
    return errorResponse(e);
  }
}
