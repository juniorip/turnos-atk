import { calculateDeposit } from "../public/buscar-cliente-utils.js";

export const COMMISSION_PLANS = ["ATK_1", "ATK_0_5", "ATK_0_35", "INTERBANK_2", "INTERBANK_1_5"] as const;
export type CommissionPlan = (typeof COMMISSION_PLANS)[number];
export const SETTLEMENT_TIMINGS = ["NEXT_BUSINESS_DAY", "SAME_DAY"] as const;
export type SettlementTiming = (typeof SETTLEMENT_TIMINGS)[number];
export const MIN_DEBT_COMMISSION = 30;
export function debtCommission(amount: number, rate: number) {
  return Math.max(MIN_DEBT_COMMISSION, (amount * rate) / 100);
}
export const commissionPlanLabel: Record<CommissionPlan, string> = {
  ATK_1: "ATK 1%", ATK_0_5: "ATK 0.5%", ATK_0_35: "ATK 0.35%", INTERBANK_2: "Interbank 2%", INTERBANK_1_5: "Interbank 1.5%",
};

// La vista previa y el guardado comparten las tarifas confirmadas del buscador.
export function effectivizacionCommission(bank: string, amount: number, plan: CommissionPlan, timing: SettlementTiming = "NEXT_BUSINESS_DAY") {
  const bankKey = ({ BCP: "bcp", BBVA: "bbva", BanBif: "banbif", Scotiabank: "scotiabank", Interbank: "interbank", CMR: "cmr", IO: "io", "Tarjeta Comercial": "diners" } as Record<string, string>)[bank];
  if (!bankKey || (plan.startsWith("INTERBANK_") && bank !== "Interbank")) throw new Error("Banco no válido para Efectivización.");
  const profile = plan === "ATK_0_35" ? "0.35%" : plan === "ATK_0_5" || plan === "INTERBANK_1_5" ? "0.5%" : "1%";
  const amountCents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || Number(amount.toFixed(2)) !== amount) throw new Error("Ingresa un monto válido con hasta dos decimales.");
  const delayed = bank === "BanBif" || bank === "Scotiabank";
  const quote = calculateDeposit({ amountCents, bankId: bankKey, profile, timing: delayed && timing === "NEXT_BUSINESS_DAY" ? "next-day" : "same-day" });
  if (!quote.ok) throw new Error("El monto de efectivización debe ser mayor que la comisión.");
  return { rate: quote.rateBps === null ? 0 : quote.rateBps / 100, profit: quote.commissionCents / 100, minimumApplied: quote.flatCents !== undefined || quote.minimumApplied };
}
