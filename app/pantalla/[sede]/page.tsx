"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { appAsset, appFetch } from "@/lib/app-fetch";

type TicketOnScreen = { code: string; isPreferential: boolean; startedAt?: string; displayName: string; module?: number | null; testOnly?: boolean; service: { name: string } };
type QueueState = {
  branch: { name: string; code: string } | null;
  calling: TicketOnScreen[];
  waitingCount: number;
  nextTickets: TicketOnScreen[];
  recentlyCompleted: { code: string; completedAt: string }[];
  error?: string;
};

export default function PantallaPublica() {
  const params = useParams<{ sede: string }>();
  const rawBranch = String(params.sede || "").trim().toUpperCase();
  const code = rawBranch === "OLIVOS" ? "OLI" : rawBranch === "LOS-OLIVOS" ? "OLI" : rawBranch;
  const [state, setState] = useState<QueueState | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [justCalled, setJustCalled] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundTestMode, setSoundTestMode] = useState<boolean | null>(null);
  const previousCodes = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const callAudio = useRef<HTMLAudioElement | null>(null);
  function attentionChime() {
    const audio = callAudio.current ?? new Audio(appAsset("/audio/llamado-ding-dong.mp3"));
    callAudio.current = audio;
    audio.volume = .75;
    audio.currentTime = 0;
    void audio.play().catch(() => { /* El botón de sonido permite desbloquear el audio. */ });
  }
  useEffect(() => () => {
    callAudio.current?.pause();
    callAudio.current = null;
  }, []);
  function toggleSound() {
    setSoundEnabled((enabled) => {
      if (!enabled) {
        // El gesto del usuario desbloquea la reproducción en navegadores de TV.
        attentionChime();
      }
      return !enabled;
    });
  }

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setSoundTestMode(new URLSearchParams(window.location.search).get("pruebaVoz") === "1");
  }, []);

  useEffect(() => {
    if (soundTestMode === null) return;
    let cancelled = false;
    async function poll() {
      try {
        const response = await appFetch(`/api/public/queue?code=${encodeURIComponent(code)}`, { cache: "no-store" });
        const json = await response.json();
        if (cancelled) return;
        if (!response.ok) { setState({ branch: null, calling: [], waitingCount: 0, nextTickets: [], recentlyCompleted: [], error: json.error }); return; }
        const currentCodes = new Set<string>(json.calling.map((ticket: TicketOnScreen) => ticket.code));
        if (!soundTestMode && !firstLoad.current) {
          const fresh = json.calling.find((ticket: TicketOnScreen) => !previousCodes.current.has(ticket.code));
          if (fresh) {
            setJustCalled(fresh.code);
            setTimeout(() => setJustCalled(null), 5500);
          }
        }
        firstLoad.current = false;
        previousCodes.current = currentCodes;
        setState(json);
      } catch { /* reintenta automáticamente */ }
    }
    poll();
    const interval = setInterval(poll, 3500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [code, soundTestMode]);

  const testTicket: TicketOnScreen = {
    code: "PRUEBA-VOZ",
    isPreferential: false,
    displayName: "Cliente de prueba",
    module: 1,
    testOnly: true,
    service: { name: "Prueba de audio · no se registra" },
  };
  const callingTickets = soundTestMode === true ? [testTicket] : state?.calling.slice(0, 3) || [];
  const callingSignature = callingTickets.map((ticket) => ticket.code).join("|");
  useEffect(() => {
    if (!soundEnabled || !callingSignature) return;
    attentionChime();
    const repeat = setInterval(attentionChime, 4800);
    return () => {
      clearInterval(repeat);
      callAudio.current?.pause();
    };
  }, [soundEnabled, callingSignature]);

  if (state?.error) return <main className="screen-page"><p className="screen-error">{state.error}</p></main>;

  const upcoming = state?.nextTickets || [];
  const date = now?.toLocaleDateString("es-PE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) || "Cargando fecha…";
  const time = now?.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) || "--:--";

  return (
    <main className="screen-page">
      <header className="screen-header">
        <img className="screen-logo" src={appAsset("/atk-peru-wk.png?v=20261019")} alt="ATK Altoque Perú WK" />
        <div className="screen-header-tools">
          <div className="screen-audio-control">
            <button className={`screen-audio-button ${soundEnabled ? "is-enabled" : ""}`} type="button" onClick={toggleSound} aria-pressed={soundEnabled} title={soundEnabled ? "Desactivar sonido de llamada." : "Activar sonido de llamada."}>
              {soundEnabled ? "🔊 Sonido activado" : "🔇 Sonido desactivado"}
            </button>
          </div>
          <div className="screen-meta">
            <span className="screen-location"><span aria-hidden="true">●</span>{state?.branch?.name || "Cargando sede…"}</span>
            <div className="screen-meta-details">
              <span><span aria-hidden="true">▦</span><b>{date}</b></span>
              <i aria-hidden="true" />
              <span><span aria-hidden="true">◷</span><b>{time}</b></span>
            </div>
          </div>
        </div>
      </header>
      <section className={`screen-call-grid calls-${Math.max(callingTickets.length, 1)}`}>
        {callingTickets.length ? callingTickets.map((ticket) => (
          <article className={`call-card current-call calling ${ticket.code === justCalled ? "flash" : ""}`} key={ticket.code}>
            <div className="call-card-top"><span>{ticket.testOnly ? "🔊 PRUEBA DE SONIDO" : "🔊 TURNO ACTUAL"}</span><b>{ticket.module ? `MÓDULO ${ticket.module}` : "LLAMANDO"}</b></div>
            <strong className="call-code">{ticket.code}</strong><h1>{ticket.displayName}</h1><p className="call-service">{ticket.service.name}</p><div className="call-instruction">🔊 <b>{ticket.module ? `Dirígete al módulo ${ticket.module}` : "Acércate para ser atendido"}</b></div>
          </article>
        )) : (
          <article className="call-card current-call"><div className="call-card-top"><span>🔊 TURNOS ACTUALES</span><b>EN ESPERA</b></div><strong className="call-code dim-code">—</strong><h1>Esperando llamado</h1><p className="call-service">El próximo ticket aparecerá aquí</p></article>
        )}
      </section>
      <section className="screen-upcoming"><div className="upcoming-title"><span>{soundTestMode ? "🧪 MODO DE PRUEBA" : "📋 SIGUIENTES EN SER LLAMADOS"}</span><b>{soundTestMode ? "Sin cambios en el sistema" : `${state?.waitingCount || 0} en espera`}</b></div><div className="screen-next-list">{soundTestMode ? <p className="screen-empty">Turno ficticio solo para comprobar el sonido. No se guarda ni aparece en la cola.</p> : upcoming.length ? upcoming.map((ticket, index) => <div className="screen-next" key={ticket.code}><i>{index + 1}</i><b>{ticket.code}{ticket.isPreferential && <small className="preferential-badge">Preferencial</small>}</b><span>{ticket.displayName} · {ticket.service.name}</span></div>) : <p className="screen-empty">No hay más tickets en espera.</p>}</div></section>
    </main>
  );
}
