export type EscalationKind = "REGISTRO" | "EFECTIVIZACION" | "PAGO_DEUDA";

type RegisterPayload = {
  ticketId: number;
  ticketCode: string;
  workerUsername: string;
  workerDni?: string | null;
  clientName: string;
  dni: string;
  kind: EscalationKind;
  uploadPlatform: "WEB" | "DRIVE";
  notes?: string | null;
  operations?: {
    serviceName: "Efectivización" | "Pago de deuda";
    bankName: string | null;
    amount: number;
    rate: number;
    profit: number;
  }[];
};

export async function sendToRegistrosAtK(payload: RegisterPayload) {
  const baseUrl = process.env.REGISTROS_ATK_URL?.replace(/\/$/, "");
  const secret = process.env.REGISTROS_ATK_SHARED_SECRET;
  if (!baseUrl || !secret) {
    return { synced: false, reason: "Integración con Registros ATK aún no configurada." };
  }

  const response = await fetch(`${baseUrl}/api/external/turnos/records`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Turnos-ATK-Key": secret,
    },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { synced: false, reason: result.error || "No se pudo enviar el registro." };
  }
  return { synced: true as const, recordId: result.record?.id as number | undefined };
}
