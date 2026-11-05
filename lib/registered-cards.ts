import type { PancakeDniCustomer } from "./pancake";
import type { CommissionPlan } from "./effectivizacion";
import { extractCards, getNoteBankOptions, resolveCommission } from "../public/buscar-cliente-utils.js";

export type CustomerProfile = "0.35%" | "0.5%" | "1%";
export type RegisteredCard = { key: string; bankKey: string; bankName: string; bankId: number | null; lastFour?: string };
const databaseBankNames: Record<string, string> = { bcp: "BCP", bbva: "BBVA", interbank: "Interbank", scotiabank: "Scotiabank", banbif: "BanBif", cmr: "CMR", io: "IO", sip: "Tarjeta Comercial", cencosud: "Tarjeta Comercial", ripley: "Tarjeta Comercial", diners: "Tarjeta Comercial" };
export function plainPancakeNotes(customer: PancakeDniCustomer) {
  return customer.notes.map(note => note.replace(/<\s*br\s*\/?\s*>/gi, "\n").replace(/<\/(?:p|div|li|tr)>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").trim());
}
export function customerProfile(customer: PancakeDniCustomer | null): CustomerProfile | null {
  if (!customer) return null;
  const profile = resolveCommission(plainPancakeNotes(customer), customer.alias || "");
  return ["0.35%", "0.5%", "1%"].includes(profile) ? profile as CustomerProfile : null;
}
export function getRegisteredCards(customer: PancakeDniCustomer | null, banks: { id: number; name: string }[]): RegisteredCard[] {
  if (!customer) return [];
  const notes = plainPancakeNotes(customer), cards = extractCards(notes);
  return getNoteBankOptions(notes).flatMap<RegisteredCard>(bank => {
    const bankId = banks.find(candidate => candidate.name === databaseBankNames[bank.id])?.id || null;
    const matches = cards.filter(card => card.bankId === bank.id);
    return matches.length ? matches.map(card => ({ key: `${bank.id}:${card.lastFour}`, bankKey: bank.id, bankName: bank.name, bankId, lastFour: card.lastFour })) : [{ key: `${bank.id}:bank`, bankKey: bank.id, bankName: bank.name, bankId }];
  });
}
export function profileCommissionPlan(profile: CustomerProfile, bankName: string): CommissionPlan {
  if (bankName === "Interbank") return profile === "1%" ? "INTERBANK_2" : "INTERBANK_1_5";
  return profile === "1%" ? "ATK_1" : profile === "0.5%" ? "ATK_0_5" : "ATK_0_35";
}
