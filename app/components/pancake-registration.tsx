"use client";

import { useEffect, useState } from "react";
import { appFetch } from "@/lib/app-fetch";
import type { PancakeDniCustomer } from "@/lib/pancake";

export type PancakeRegistrationStatus = "loading" | "registered" | "registered-manual" | "not-found" | "incomplete" | "unavailable";

export default function PancakeRegistration({ ticketId, manualRegistered = false, statusOverride, onManualRegisteredChange, onStatusChange, onCustomerChange }: { ticketId: number; manualRegistered?: boolean; statusOverride?: PancakeRegistrationStatus; onManualRegisteredChange?: (ticketId: number, registered: boolean) => void; onStatusChange?: (ticketId: number, status: PancakeRegistrationStatus) => void; onCustomerChange?: (ticketId: number, customer: PancakeDniCustomer | null, checkedAt: string | null) => void }) {
  const [status, setStatus] = useState<PancakeRegistrationStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (manualRegistered) {
      setStatus("registered-manual");
      onStatusChange?.(ticketId, "registered-manual");
      return;
    }
    let disposed = false;
    const controller = new AbortController();
    const updateStatus = (next: PancakeRegistrationStatus) => {
      setStatus(next);
      onStatusChange?.(ticketId, next);
    };
    updateStatus("loading");
    void (async () => {
      try {
        const response = await appFetch(`/api/tickets/${ticketId}/pancake-customer${attempt > 0 ? "?refresh=1" : ""}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error("Lookup failed");
        // Pending results are refreshed in one batched request every minute by the active-ticket scheduler.
        if (payload.state === "pending") return;
        const result = payload.result;
        if (!result?.ok || typeof result.found !== "boolean") throw new Error("Lookup failed");
        if (disposed) return;
        const nextStatus = result.found ? "registered" : result.complete ? "not-found" : "incomplete";
        updateStatus(nextStatus);
        onCustomerChange?.(ticketId, result.customer, payload.checkedAt);
      } catch {
        if (disposed || controller.signal.aborted) return;
        updateStatus("unavailable");
      }
    })();
    return () => { disposed = true; controller.abort(); };
  }, [ticketId, attempt, manualRegistered, onManualRegisteredChange, onStatusChange, onCustomerChange]);

  const visibleStatus = statusOverride ?? status;
  const label = { loading: "Consultando Pancake…", registered: "Registrado en Pancake", "registered-manual": "Registrado · confirmado manualmente", "not-found": "No se encontró en Pancake", incomplete: "Búsqueda incompleta", unavailable: "No se pudo comprobar" }[visibleStatus];
  const detail = visibleStatus === "not-found" ? "Se revisaron las conversaciones disponibles. Turnos volverá a buscar automáticamente cada minuto mientras este ticket siga activo." : visibleStatus === "incomplete" ? "La búsqueda no alcanzó todas las conversaciones. Turnos volverá a consultar automáticamente cada minuto mientras este ticket siga activo." : visibleStatus === "registered-manual" ? "Marcado manualmente como registrado. Esta confirmación no envía un registro nuevo a Registros ATK." : visibleStatus === "unavailable" ? "La consulta falló. Turnos volverá a intentar automáticamente cada minuto mientras este ticket siga activo." : label;
  const canConfirmManually = visibleStatus === "not-found" || visibleStatus === "incomplete" || visibleStatus === "unavailable" || visibleStatus === "registered-manual";
  return <span className="pancake-registration">
    <span className={"pancake-registration-badge is-" + visibleStatus} role="status" aria-live="polite" title={detail}>
      <span aria-hidden="true">{visibleStatus === "registered" || visibleStatus === "registered-manual" ? "✓" : visibleStatus === "not-found" ? "✕" : visibleStatus === "loading" ? "◌" : "—"}</span> {label}
    </span>
    {canConfirmManually && <label className="pancake-manual-confirm" title="Marca esto solo si verificaste que el cliente ya está registrado.">
      <input type="checkbox" checked={visibleStatus === "registered-manual"} onChange={(event) => {
        if (event.target.checked) onManualRegisteredChange?.(ticketId, true);
        else { onManualRegisteredChange?.(ticketId, false); setAttempt(value => value + 1); }
      }} />
      <span>Ya está registrado</span>
    </label>}
    <button type="button" disabled={visibleStatus === "loading"} onClick={() => { if (manualRegistered) onManualRegisteredChange?.(ticketId, false); setAttempt(value => value + 1); }} aria-label="Volver a consultar en Pancake" title="Volver a consultar en Pancake">↻</button>
  </span>;
}
