export const COMMISSION_PLANS = ["ATK_1", "ATK_0_5", "ATK_0_35", "INTERBANK_2", "INTERBANK_1_5"] as const;
export type CommissionPlan = (typeof COMMISSION_PLANS)[number];
export const SETTLEMENT_TIMINGS = [
  "NEXT_BUSINESS_DAY",
  "SAME_DAY",
] as const;
export type SettlementTiming = (typeof SETTLEMENT_TIMINGS)[number];

export const MIN_DEBT_COMMISSION = 30;

export function debtCommission(amount: number, rate: number) {
  return Math.max(MIN_DEBT_COMMISSION, (amount * rate) / 100);
}

export const commissionPlanLabel: Record<CommissionPlan, string> = {
  ATK_1: "ATK 1%",
  ATK_0_5: "ATK 0.5%",
  ATK_0_35: "ATK 0.35%",
  INTERBANK_2: "Interbank 2%",
  INTERBANK_1_5: "Interbank 1.5%",
};

type Rule = {
  rate: number;
  sameDayRate?: number;
  threshold: number;
  minimum: number;
  fixedProfit?: number;
};
const rules: Record<CommissionPlan, Record<string, Rule>> = {
  INTERBANK_2: {
    Interbank: { rate: 2, threshold: 0, minimum: 0 },
  },
  INTERBANK_1_5: {
    Interbank: { rate: 1.5, threshold: 0, minimum: 0 },
  },
  ATK_1: {
    BCP: { rate: 1, threshold: 1200, minimum: 12 },
    BBVA: { rate: 1, threshold: 1200, minimum: 12 },
    BanBif: { rate: 1, sameDayRate: 1.5, threshold: 1200, minimum: 12 },
    Scotiabank: { rate: 1, sameDayRate: 1.5, threshold: 2000, minimum: 20 },
    Interbank: { rate: 1.5, threshold: 1500, minimum: 30 },
    CMR: { rate: 2, threshold: 1500, minimum: 30 },
    "Tarjeta Comercial": { rate: 8, threshold: 375, minimum: 30 },
    IO: { rate: 0, threshold: 0, minimum: 30, fixedProfit: 30 },
  },
  ATK_0_5: {
    BCP: { rate: 0.5, threshold: 2400, minimum: 12 },
    BBVA: { rate: 0.5, threshold: 2400, minimum: 12 },
    BanBif: { rate: 0.5, sameDayRate: 1, threshold: 2400, minimum: 12 },
    Scotiabank: { rate: 0.5, sameDayRate: 1, threshold: 4000, minimum: 20 },
    Interbank: { rate: 1.5, threshold: 2000, minimum: 30 },
    CMR: { rate: 2, threshold: 1500, minimum: 30 },
    "Tarjeta Comercial": { rate: 8, threshold: 375, minimum: 30 },
    IO: { rate: 0, threshold: 0, minimum: 30, fixedProfit: 30 },
  },
  ATK_0_35: {
    BCP: { rate: 0.5, threshold: 2400, minimum: 12 },
    BBVA: { rate: 0.35, threshold: 3430, minimum: 12 },
    BanBif: { rate: 0.35, sameDayRate: 1, threshold: 3430, minimum: 12 },
    Scotiabank: { rate: 0.35, sameDayRate: 1, threshold: 5715, minimum: 20 },
    Interbank: { rate: 1.5, threshold: 2000, minimum: 30 },
    CMR: { rate: 2, threshold: 1500, minimum: 30 },
    "Tarjeta Comercial": { rate: 8, threshold: 375, minimum: 30 },
    IO: { rate: 0, threshold: 0, minimum: 30, fixedProfit: 30 },
  },
};

export function effectivizacionCommission(
  bank: string,
  amount: number,
  plan: CommissionPlan,
  timing: SettlementTiming = "NEXT_BUSINESS_DAY",
) {
  const rule = rules[plan][bank];
  if (!rule) throw new Error("Banco no válido para Efectivización.");
  if (rule.fixedProfit !== undefined) {
    return { rate: 0, profit: rule.fixedProfit, minimumApplied: true };
  }
  const rate =
    timing === "SAME_DAY" && rule.sameDayRate ? rule.sameDayRate : rule.rate;
  const profit =
    amount < rule.threshold ? rule.minimum : (amount * rate) / 100;
  return { rate, profit, minimumApplied: amount < rule.threshold };
}
