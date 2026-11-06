"use client";

import { useEffect, useMemo } from "react";
import type { PancakeDniCustomer } from "@/lib/pancake";
import type { CommissionPlan, SettlementTiming } from "@/lib/effectivizacion";
import { customerProfile, getRegisteredCards, profileCommissionPlan, type CustomerProfile } from "@/lib/registered-cards";
import { calculateDeposit, parseAmountCents } from "../../public/buscar-cliente-utils.js";
import BankLogo from "./bank-logo";

export type AutomaticOperationFields = { bankId: number | null; amount: string; commissionPlan: CommissionPlan; settlementTiming: SettlementTiming; commercialChannel?: "POS" | "PAYMENT_LINK" | null; cardKey?: string; customerProfile?: CustomerProfile; profileDetected?: boolean };
export default function AutomaticEfectivization({ operation, customer, banks, index, onChange, showQuote = true }: { operation: AutomaticOperationFields; customer: PancakeDniCustomer | null; banks: { id: number; name: string }[]; index: number; onChange: (patch: Partial<AutomaticOperationFields>) => void; showQuote?: boolean }) {
  const cards = useMemo(() => getRegisteredCards(customer, banks), [customer, banks]);
  const selectedCard = cards.find(card => card.key === operation.cardKey);
  const selectedBank = banks.find(bank => bank.id === operation.bankId);
  const bankKeyForName = (name: string) => {
    const normalized = name.toLowerCase();
    if (normalized.includes("scotia")) return "scotiabank";
    if (normalized.includes("banbif")) return "banbif";
    if (normalized.includes("interbank")) return "interbank";
    if (normalized.includes("cmr")) return "cmr";
    if (normalized === "io") return "io";
    if (normalized.includes("comercial")) return "sip";
    if (normalized.includes("bbva")) return "bbva";
    return "bcp";
  };
  const selected = selectedCard || (selectedBank ? { key: `manual:${selectedBank.id}`, bankId: selectedBank.id, bankName: selectedBank.name, bankKey: bankKeyForName(selectedBank.name), lastFour: undefined } : undefined);
  const operationBankName = selected?.bankId ? banks.find(bank => bank.id === selected.bankId)?.name || selected.bankName : selected?.bankName;
  const operationBankKey = operationBankName ? bankKeyForName(operationBankName) : undefined;
  const detected = customerProfile(customer);
  const profile = detected || operation.customerProfile;
  const optionsKey = cards.map(card => `${card.key}:${card.bankId}`).join("|");
  useEffect(() => {
    if (detected && (operation.customerProfile !== detected || !operation.profileDetected)) onChange({ customerProfile: detected, profileDetected: true });
    else if (customer && !detected && operation.profileDetected) onChange({ customerProfile: undefined, profileDetected: false });
  }, [customer, detected, operation.customerProfile, operation.profileDetected, onChange]);
  useEffect(() => {
    // The customer record can be temporarily absent while switching between
    // active tickets. Keep the saved bank/card until this ticket's Pancake data
    // is available again, otherwise its draft loses the selection and quote.
    if (customer && operation.cardKey && (!selectedCard || selectedCard.bankId !== operation.bankId)) onChange({ cardKey: undefined, bankId: null });
  }, [customer, optionsKey, operation.cardKey, operation.bankId, selectedCard, onChange]);
  useEffect(() => {
    if (!profile || !selected?.bankId) return;
    const name = banks.find(bank => bank.id === selected.bankId)?.name || "";
    const plan = profileCommissionPlan(profile, name);
    if (operation.commissionPlan !== plan) onChange({ commissionPlan: plan });
  }, [profile, selected, operation.commissionPlan, banks, onChange]);
  const amountCents = parseAmountCents(operation.amount);
  const delayed = operationBankKey && ["banbif", "scotiabank"].includes(operationBankKey);
  const commercialCard = operationBankName === "Tarjeta Comercial";
  const quote = selected && profile && amountCents && operationBankKey ? calculateDeposit({ amountCents, bankId: operationBankKey, profile, timing: delayed && operation.settlementTiming === "NEXT_BUSINESS_DAY" ? "next-day" : "same-day" }) : null;
  const money = (cents: number) => `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return <section className="automatic-efectivization" aria-label={`Efectivización automática ${index + 1}`}>
    <div className="automatic-profile"><b>Porcentaje del cliente: {profile || "Por confirmar"}</b>{detected && <small>Obtenido de Pancake</small>}</div>
    {!detected && <label>Confirma el porcentaje del cliente<select aria-label={`Porcentaje del cliente ${index + 1}`} value={operation.customerProfile || ""} onChange={event => onChange({ customerProfile: event.target.value as CustomerProfile, profileDetected: false })}><option value="">Selecciona un porcentaje</option><option value="0.35%">0.35%</option><option value="0.5%">0.5%</option><option value="1%">1%</option></select></label>}
    {cards.length > 0 && <>
      <p className="automatic-cards-label">Tarjetas y bancos registrados</p>
      <div className="registered-card-options">{cards.map(card => <button type="button" key={card.key} className={`registered-card-choice${selectedCard?.key === card.key ? " is-selected" : ""}`} aria-pressed={selectedCard?.key === card.key} disabled={!card.bankId} aria-label={`Usar ${card.bankName}${card.lastFour ? ` terminada en ${card.lastFour}` : " sin terminación"}`} onClick={() => onChange({ cardKey: card.key, bankId: card.bankId, settlementTiming: "NEXT_BUSINESS_DAY", commercialChannel: card.bankId && banks.find(bank => bank.id === card.bankId)?.name === "Tarjeta Comercial" ? operation.commercialChannel || "POS" : null })}>
        <BankLogo bankKey={card.bankKey} name={card.bankName} /><span>{card.lastFour ? `•••• ${card.lastFour}` : "Sin terminación en notas"}</span>{!card.bankId && <small>Banco no habilitado</small>}
      </button>)}</div>
    </>}
    {!cards.length && <>
      <p role="status">{customer ? "No hay tarjetas identificadas en Pancake. Registra la operación con los datos que confirme el cliente." : "Sin datos de Pancake de la cola. Registra la operación manualmente con los datos confirmados por el cliente."}</p>
      <label>Banco<select aria-label={`Banco manual de la operación ${index + 1}`} value={operation.bankId ?? ""} onChange={event => onChange({ bankId: event.target.value ? Number(event.target.value) : null, cardKey: undefined, commercialChannel: null })}>
        <option value="">Selecciona banco</option>
        {banks.filter(bank => ["BCP", "BBVA", "BanBif", "Scotiabank", "Interbank", "CMR", "IO", "Tarjeta Comercial"].includes(bank.name)).map(bank => <option key={bank.id} value={bank.id}>{bank.name}</option>)}
      </select></label>
    </>}
    {selected && commercialCard && <label>Canal<select value={operation.commercialChannel || "POS"} onChange={event => onChange({ commercialChannel: event.target.value as "POS" | "PAYMENT_LINK" })}><option value="POS">POS</option><option value="PAYMENT_LINK">Link de pago</option></select></label>}
    {delayed && <label>Plazo del depósito<select aria-label={`Plazo del depósito ${index + 1}`} value={operation.settlementTiming} onChange={event => onChange({ settlementTiming: event.target.value as SettlementTiming })}><option value="NEXT_BUSINESS_DAY">Siguiente día hábil</option><option value="SAME_DAY">Mismo día</option></select></label>}
    <label>Monto de la efectivización (S/)<input aria-label={`Monto de efectivización ${index + 1}`} placeholder="Monto S/" type="text" inputMode="decimal" value={operation.amount} onChange={event => onChange({ amount: event.target.value })} /></label>
    {quote?.ok ? showQuote && <div className="automatic-deposit" aria-live="polite"><p>Tarifa aplicada: <b>{quote.flatCents !== undefined ? "S/ 30.00 fijos" : `${(quote.rateBps || 0) / 100}%`}</b>{quote.minimumApplied ? ` · Mínimo ${money(quote.minimumCents)}` : ""}</p><p>Comisión: <b>{money(quote.commissionCents)}</b></p><p className="automatic-deposit-net">Se deposita: <strong>{money(quote.depositCents)}</strong></p></div> : operation.amount && <p className="automatic-quote-error" role="status">{!selected ? "Selecciona una tarjeta o banco registrado." : !profile ? "Confirma el porcentaje del cliente." : !amountCents ? "Ingresa un monto válido, con hasta dos decimales." : "El monto debe ser mayor que la comisión mínima."}</p>}
  </section>;
}
