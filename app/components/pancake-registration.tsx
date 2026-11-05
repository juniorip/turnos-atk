"use client";

import { useEffect, useState } from "react";
import { appFetch } from "@/lib/app-fetch";
import type { PancakeDniCustomer } from "@/lib/pancake";

export type PancakeRegistrationStatus = "loading" | "registered" | "not-found" | "unavailable";

export default function PancakeRegistration({ ticketId, onStatusChange, onCustomerChange }: { ticketId: number; onStatusChange?: (ticketId: number, status: PancakeRegistrationStatus) => void; onCustomerChange?: (ticketId: number, customer: PancakeDniCustomer | null, checkedAt: string | null) => void }) {
  const [status, setStatus] = useState<PancakeRegistrationStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 65000);
    const updateStatus = (next: PancakeRegistrationStatus) => {
      setStatus(next);
      onStatusChange?.(ticketId, next);
    };
    updateStatus("loading");
    void (async () => {
      try {
        let refresh = attempt > 0;
        while (!disposed) {
          const response = await appFetch(`/api/tickets/${ticketId}/pancake-customer${refresh ? "?refresh=1" : ""}`, { cache: "no-store", signal: controller.signal });
          refresh = false;
          const payload = await response.json();
          if (!response.ok) throw new Error("Lookup failed");
          if (payload.state === "pending") {
            await new Promise(resolve => setTimeout(resolve, 1500));
            continue;
          }
          const result = payload.result;
          if (!result?.ok || typeof result.found !== "boolean") throw new Error("Lookup failed");
          if (!disposed) {
            updateStatus(result.found ? "registered" : "not-found");
            onCustomerChange?.(ticketId, result.customer, payload.checkedAt);
          }
          break;
        }
      } catch {
        if (!disposed) updateStatus("unavailable");
      } finally { clearTimeout(timeout); }
    })();
    return () => { disposed = true; clearTimeout(timeout); controller.abort(); };
  }, [ticketId, attempt, onStatusChange, onCustomerChange]);

  const label = { loading: "Consultando Pancake…", registered: "Registrado", "not-found": "Posiblemente no registrado", unavailable: "No se pudo comprobar" }[status];
  const detail = status === "not-found" ? "No se encontró el DNI en las conversaciones revisadas de Pancake. Puede existir un registro anterior o sin el DNI en el alias." : status === "unavailable" ? "La consulta falló. Esto no significa que el cliente no esté registrado." : label;
  return <span className="pancake-registration">
    <span className={`pancake-registration-badge is-${status}`} role="status" aria-live="polite" title={detail}>
      <span aria-hidden="true">{status === "registered" ? "✓" : status === "not-found" ? "✕" : status === "loading" ? "◌" : "—"}</span> {label}
    </span>
    <button type="button" disabled={status === "loading"} onClick={() => setAttempt(value => value + 1)} aria-label="Volver a consultar en Pancake" title="Volver a consultar en Pancake">↻</button>
  </span>;
}
