"use client";

import { useEffect, useMemo } from "react";
import type { PancakeDniCustomer } from "@/lib/pancake";
import type { CommissionPlan, SettlementTiming } from "@/lib/effectivizacion";
import { customerProfile, getRegisteredCards, profileCommissionPlan, type CustomerProfile } from "@/lib/registered-cards";
import { calculateDeposit, parseAmountCents } from "../../public/buscar-cliente-utils.js";
import BankLogo from "./bank-logo";

export type AutomaticOperationFields = { bankId: number | null; amount: string; commissionPlan: CommissionPlan; settlementTiming: SettlementTiming; commercialChannel?: "POS" | "PAYMENT_LINK" | null; cardKey?: string; customerProfile?: CustomerProfile; profileDetected?: boolean };
export default function AutomaticEfectivization({ operation, customer, banks, index, onChange }: { operation: AutomaticOperationFields; customer: PancakeDniCustomer | null; banks: { id: number; name: string }[]; index: number; onChange: (patch: Partial<AutomaticOperationFields>) => void }) {
  const cards = useMemo(() => getRegisteredCards(customer, banks), [customer, banks]);
  const selected = cards.find(card => card.key === operation.cardKey);
  const detected = customerProfile(customer);
  const profile = detected || operation.customerProfile;
  const optionsKey = cards.map(card => `${card.key}:${card.bankId}`).join("|");
  useEffect(() => {
    if (detected && (operation.customerProfile !== detected || !operation.profileDetected)) onChange({ customerProfile: detected, profileDetected: true });
    else if (!detected && operation.profileDetected) onChange({ customerProfile: undefined, profileDetected: false });
  }, [detected, operation.customerProfile, operation.profileDetected, onChange]);
  useEffect(() => {
    if (operation.cardKey && (!selected || selected.bankId !== operation.bankId)) onChange({ cardKey: undefined, bankId: null });
  }, [optionsKey, operation.cardKey, operation.bankId, selected, onChange]);
  useEffect(() => {
    if (!profile || !selected?.bankId) return;
    const name = banks.find(bank => bank.id === selected.bankId)?.name || "";
    const plan = profileCommissionPlan(profile, name);
    if (operation.commissionPlan !== plan) onChange({ commissionPlan: plan });
  }, [profile, selected, operation.commissionPlan, banks, onChange]);
  const amountCents = parseAmountCents(operation.amount);
  const delayed = selected && ["banbif", "scotiabank"].includes(selected.bankKey);
  const quote = selected && profile && amountCents ? calculateDeposit({ amountCents, bankId: selected.bankKey, profile, timing: delayed && operation.settlementTiming === "NEXT_BUSINESS_DAY" ? "next-day" : "same-day" }) : null;
  const money = (cents: number) => `S/ ${(cents / 100).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return <section className="automatic-efectivization" aria-label={`Efectivización automática ${index + 1}`}>
    <div className="automatic-profile"><b>Porcentaje del cliente: {profile || "Por confirmar"}</b>{detected && <small>Obtenido de Pancake</small>}</div>
    {!detected && <label>Confirma el porcentaje del cliente<select aria-label={`Porcentaje del cliente ${index + 1}`} value={operation.customerProfile || ""} onChange={event => onChange({ customerProfile: event.target.value as CustomerProfile, profileDetected: false })}><option value="">Selecciona un porcentaje</option><option value="0.35%">0.35%</option><option value="0.5%">0.5%</option><option value="1%">1%</option></select></label>}
    <p className="automatic-cards-label">Tarjetas y bancos registrados</p>
    <div className="registered-card-options">{cards.map(card => <button type="button" key={card.key} className={`registered-card-choice${selected?.key === card.key ? " is-selected" : ""}`} aria-pressed={selected?.key === card.key} disabled={!card.bankId} aria-label={`Usar ${card.bankName}${card.lastFour ? ` terminada en ${card.lastFour}` : " sin terminación"}`} onClick={() => onChange({ cardKey: card.key, bankId: card.bankId, settlementTiming: "NEXT_BUSINESS_DAY", commercialChannel: ["sip", "cencosud", "ripley", "diners"].includes(card.bankKey) ? operation.commercialChannel || "POS" : null })}>
      <BankLogo bankKey={card.bankKey} name={card.bankName} /><span>{card.lastFour ? `•••• ${card.lastFour}` : "Sin terminación en notas"}</span>{!card.bankId && <small>Banco no habilitado</small>}
    </button>)}</div>
    {!cards.length && <p role="status">{customer ? "No hay tarjetas ni bancos identificados en las notas. Actualiza Pancake y pulsa ↻ para consultarlos." : "Esperando datos de Pancake. Si el cliente es nuevo, registra sus tarjetas y actualiza la consulta."}</p>}
    {selected && ["sip", "cencosud", "ripley", "diners"].includes(selected.bankKey) && <label>Canal<select value={operation.commercialChannel || "POS"} onChange={event => onChange({ commercialChannel: event.target.value as "POS" | "PAYMENT_LINK" })}><option value="POS">POS</option><option value="PAYMENT_LINK">Link de pago</option></select></label>}
    {delayed && <label>Plazo del depósito<select aria-label={`Plazo del depósito ${index + 1}`} value={operation.settlementTiming} onChange={event => onChange({ settlementTiming: event.target.value as SettlementTiming })}><option value="NEXT_BUSINESS_DAY">Siguiente día hábil</option><option value="SAME_DAY">Mismo día</option></select></label>}
    <label>Monto de la efectivización (S/)<input aria-label={`Monto de efectivización ${index + 1}`} placeholder="Monto S/" type="text" inputMode="decimal" value={operation.amount} onChange={event => onChange({ amount: event.target.value })} /></label>
    {quote?.ok ? <div className="automatic-deposit" aria-live="polite"><p>Tarifa aplicada: <b>{quote.flatCents !== undefined ? "S/ 30.00 fijos" : `${(quote.rateBps || 0) / 100}%`}</b>{quote.minimumApplied ? ` · Mínimo ${money(quote.minimumCents)}` : ""}</p><p>Comisión: <b>{money(quote.commissionCents)}</b></p><p className="automatic-deposit-net">Se deposita: <strong>{money(quote.depositCents)}</strong></p></div> : operation.amount && <p className="automatic-quote-error" role="status">{!selected ? "Selecciona una tarjeta o banco registrado." : !profile ? "Confirma el porcentaje del cliente." : !amountCents ? "Ingresa un monto válido, con hasta dos decimales." : "El monto debe ser mayor que la comisión mínima."}</p>}
  </section>;
}
