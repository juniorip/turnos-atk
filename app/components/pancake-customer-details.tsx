"use client";

import { useMemo } from "react";
import type { PancakeDniCustomer } from "@/lib/pancake";
import { resolveCommission, extractAccounts, extractCards, getNoteBankOptions } from "../../public/buscar-cliente-utils.js";

export function parsePancakeDetails(customer: PancakeDniCustomer) {
  const notes = customer.notes.map(note => note.replace(/<\s*br\s*\/?\s*>/gi, "\n").replace(/<\/(?:p|div|li|tr)>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").trim());
  const lines = notes.join("\n").split("\n").map(line => line.trim()).filter(Boolean);
  const email = notes.join("\n").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const address = lines.find(line => /^(?:DIRECCI[ÓO]N\s*:|(?:AV\.?|AVENIDA|JR\.?|JIR[ÓO]N|CALLE|CL\.?|PASAJE|PSJE\.?|URB\.?|MZ\.?|LOTE|ASOC\.?|PROLONG\.?|CARRETERA|PJE\.?|MALEC[ÓO]N)\b)/i.test(line));
  const accounts = extractAccounts(notes), cards = extractCards(notes), banks = getNoteBankOptions(notes);
  return { notes, email, address, accounts, cards, banks, commission: resolveCommission(notes, customer.alias || "") };
}

export default function PancakeCustomerDetails({ customer, checkedAt }: { customer: PancakeDniCustomer; checkedAt: string | null }) {
  const data = useMemo(() => parsePancakeDetails(customer), [customer]);
  return <section className="pancake-customer-details" aria-label="Información del cliente en Pancake">
    <h3>Información del cliente</h3>
    <dl className="pancake-customer-fields">
      <div><dt>Perfil de comisión</dt><dd>{data.commission || "Por confirmar"}</dd></div>
      <div><dt>Correo</dt><dd>{data.email || "Sin correo en notas"}</dd></div>
      <div><dt>Dirección</dt><dd>{data.address || "Sin dirección en notas"}</dd></div>
      <div><dt>Nombre del perfil</dt><dd>{customer.profileName || "Sin nombre de perfil"}</dd></div>
    </dl>
    <h4>Bancos, tarjetas y cuentas</h4>
    {data.banks.map(bank => <div className="pancake-customer-bank" key={bank.id}>
      <b>{bank.name}</b>
      {data.cards.filter(card => card.bankId === bank.id).map(card => <p key={card.lastFour}>Tarjeta · •••• {card.lastFour}</p>)}
      {data.accounts.filter(account => account.bankId === bank.id).map(account => <p key={`${account.kind}-${account.account}`}>{account.kind} · {account.account}</p>)}
      {!data.cards.some(card => card.bankId === bank.id) && !data.accounts.some(account => account.bankId === bank.id) && <p>Sin número registrado en notas.</p>}
    </div>)}
    {data.accounts.filter(account => !account.bankId).map(account => <div className="pancake-customer-bank" key={`${account.kind}-${account.account}`}><b>Banco sin identificar</b><p>{account.kind} · {account.account}</p></div>)}
    {!data.banks.length && !data.accounts.length && <p>No se identificaron bancos ni tarjetas en las notas.</p>}
    <details><summary>Ver alias y notas de Pancake</summary><p>{customer.alias || "Sin alias"}</p>{data.notes.map((note, index) => <p className="pancake-customer-note" key={index}>{note}</p>)}</details>
    {checkedAt && <small>Última consulta: {new Date(checkedAt).toLocaleString("es-PE")}. Usa ↻ junto a «Registrado» para actualizar.</small>}
  </section>;
}
