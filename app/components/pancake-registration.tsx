"use client";

import { useEffect, useState } from "react";
import { appFetch } from "@/lib/app-fetch";
import type { PancakeDniCustomer } from "@/lib/pancake";

type LookupStatus = "loading" | "registered" | "not-found" | "incomplete" | "not-checked" | "unavailable";

export default function PancakeRegistration({ ticketId, onCustomerChange }: {
  ticketId: number;
  onCustomerChange?: (ticketId: number, customer: PancakeDniCustomer | null, checkedAt: string | null) => void;
}) {
  const [status, setStatus] = useState<LookupStatus>("loading");

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await appFetch(`/api/tickets/${ticketId}/pancake-customer`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error("Lookup failed");
        if (disposed) return;
        if (payload.state === "pending") {
          setStatus("not-checked");
          onCustomerChange?.(ticketId, null, null);
          return;
        }
        const result = payload.result;
        if (!result?.ok || typeof result.found !== "boolean") {
          setStatus("unavailable");
          onCustomerChange?.(ticketId, null, payload.checkedAt || null);
          return;
        }
        setStatus(result.found ? "registered" : result.complete ? "not-found" : "incomplete");
        onCustomerChange?.(ticketId, result.customer || null, payload.checkedAt || null);
      } catch {
        if (disposed || controller.signal.aborted) return;
        setStatus("unavailable");
        onCustomerChange?.(ticketId, null, null);
      }
    })();
    return () => { disposed = true; controller.abort(); };
  }, [ticketId, onCustomerChange]);

  const label: Record<LookupStatus, string> = {
    loading: "Revisando resultado de cola…",
    registered: "Registrado en Pancake",
    "not-found": "No se encontró en Pancake",
    incomplete: "Búsqueda de cola incompleta",
    "not-checked": "Sin resultado de Pancake",
    unavailable: "No se pudo comprobar Pancake",
  };
  const detail: Record<LookupStatus, string> = {
    loading: "Mostramos únicamente el resultado guardado durante la espera en cola.",
    registered: "Datos encontrados en la búsqueda realizada mientras el ticket estaba en espera.",
    "not-found": "No se encontró en la búsqueda de cola. Continúa ingresando las operaciones según lo que confirme el cliente.",
    incomplete: "La búsqueda en cola no pudo revisar todas las conversaciones. Puedes ingresar las operaciones manualmente.",
    "not-checked": "No hay datos disponibles de la búsqueda en cola. Ingresa banco, porcentaje y monto manualmente; la decisión de registrar la toma el colaborador.",
    unavailable: "La consulta de cola no estuvo disponible. Puedes continuar con las operaciones manualmente.",
  };

  return <span className="pancake-registration">
    <span className={`pancake-registration-badge is-${status}`} role="status" aria-live="polite" title={detail[status]}>
      <span aria-hidden="true">{status === "registered" ? "✓" : status === "loading" ? "◌" : status === "not-found" ? "✕" : "—"}</span> {label[status]}
    </span>
  </span>;
}
