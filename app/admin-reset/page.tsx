"use client";

import { useState } from "react";

type BackupInfo = { backupHash: string; generatedAt: string; ticketCount: number };

export default function AdminTicketResetPage() {
  const [backup, setBackup] = useState<BackupInfo | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function downloadBackup() {
    setBusy(true);
    setMessage("");
    setBackup(null);
    try {
      const response = await fetch("/api/admin/tickets-maintenance", { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setMessage(result.error || "No se pudo preparar el respaldo. Confirma que estés en la sesión de administrador.");
        return;
      }
      const archive = await response.json();
      if (archive.format !== "turnos-atk-ticket-backup-v1" || !/^[a-f0-9]{64}$/.test(archive.backupHash)) {
        setMessage("El archivo recibido no pasó la validación.");
        return;
      }
      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `turnos-atk-respaldo-tickets-${archive.generatedAt.slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackup({ backupHash: archive.backupHash, generatedAt: archive.generatedAt, ticketCount: archive.ticketCount });
      setMessage(`Respaldo descargado: ${archive.ticketCount} ticket(s), con su historial y operaciones.`);
    } catch {
      setMessage("No se pudo conectar para crear el respaldo.");
    } finally {
      setBusy(false);
    }
  }

  async function resetTickets() {
    if (!backup || confirmation !== "BORRAR TODO") return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/tickets-maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "BORRAR_TODOS_LOS_TICKETS", backupHash: backup.backupHash }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.error || "No se pudo reiniciar el sistema.");
        if (response.status === 409) setBackup(null);
        return;
      }
      setBackup(null);
      setConfirmation("");
      setMessage(`Reinicio completado: ${result.deleted} ticket(s) eliminados. Los usuarios y la configuración se conservaron.`);
    } catch {
      setMessage("No se pudo conectar para reiniciar los tickets.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: "48px auto", padding: 24, color: "#eaf2ff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ padding: 24, border: "1px solid #29415f", borderRadius: 16, background: "#101b2a" }}>
        <span style={{ color: "#76adff", fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>MANTENIMIENTO ADMINISTRATIVO</span>
        <h1 style={{ margin: "8px 0 12px" }}>Reiniciar tickets</h1>
        <p>Se eliminarán todos los tickets, incluidos los finalizados, fallidos y cancelados, junto con su historial y operaciones. Las cuentas de usuario, sedes, módulos, trámites y tasas se conservarán.</p>
        <p>Primero descarga el respaldo. El botón de reinicio se habilitará después de que el archivo quede preparado.</p>
        <button onClick={downloadBackup} disabled={busy} style={{ padding: "12px 18px", borderRadius: 8, border: 0, background: "#347fdd", color: "white", fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>
          {busy ? "Procesando…" : "Descargar respaldo JSON"}
        </button>
        {backup && <div style={{ marginTop: 18, padding: 16, border: "1px solid #3a6b9e", borderRadius: 10 }}>
          <b>Respaldo listo · {backup.ticketCount} ticket(s)</b>
          <p style={{ margin: "8px 0" }}>Verifica que el archivo descargado esté guardado. Para habilitar el reinicio, escribe <b>BORRAR TODO</b>.</p>
          <input aria-label="Confirmación de reinicio" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Escribe BORRAR TODO" style={{ padding: 10, width: "100%", maxWidth: 320, marginBottom: 12 }} />
          <br />
          <button onClick={resetTickets} disabled={busy || confirmation !== "BORRAR TODO"} style={{ padding: "12px 18px", borderRadius: 8, border: "1px solid #a44b5a", background: confirmation === "BORRAR TODO" ? "#7f2939" : "#343b49", color: "white", fontWeight: 700, cursor: busy || confirmation !== "BORRAR TODO" ? "not-allowed" : "pointer" }}>
            Reiniciar y eliminar todos los tickets
          </button>
        </div>}
        {message && <p role="status" style={{ marginTop: 18, padding: 12, background: "#16253a", borderRadius: 8 }}>{message}</p>}
      </section>
    </main>
  );
}
