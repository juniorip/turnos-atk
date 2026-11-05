export type CustomerAccount = { bankId: string; bank: string; kind: string; account: string };
export type CustomerCard = { bankId: string; bank: string; lastFour: string };
export function resolveCommission(notes: string[], alias?: string | null): string;
export function extractAccounts(notes: string[]): CustomerAccount[];
export function extractCards(notes: string[]): CustomerCard[];
export function getNoteBankOptions(notes: string[]): {id: string; name: string; label: string}[];
export function parseAmountCents(value: string): number | null;
export type DepositQuote = { ok: true; amountCents: number; commissionCents: number; depositCents: number; minimumCents: number; minimumApplied: boolean; rateBps: number | null; flatCents?: number } | { ok: false; reason: string; commissionCents?: number };
export function calculateDeposit(input: { amountCents: number; bankId: string; profile: string; timing?: string }): DepositQuote;
