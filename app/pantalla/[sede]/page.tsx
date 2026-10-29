"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type TicketOnScreen = { code: string; isPreferential: boolean; startedAt?: string; displayName: string; module?: number | null; testOnly?: boolean; service: { name: string } };
type QueueState = {
  branch: { name: string; code: string } | null;
  calling: TicketOnScreen[];
  waitingCount: number;
  nextTickets: TicketOnScreen[];
  recentlyCompleted: { code: string; completedAt: string }[];
  error?: string;
};

function attentionChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    void ctx.resume();
    // Timbre de tres tonos, pensado para una TV/sala de espera.
    [740, 1040, 740].forEach((frequency, index) => {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.connect(gain); gain.connect(ctx.destination);
      oscillator.type = "triangle";
      oscillator.frequency.value = frequency;
      const start = ctx.currentTime + index * .34;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(.42, start + .035);
      gain.gain.exponentialRampToValueAtTime(.0001, start + .29);
      oscillator.start(start);
      oscillator.stop(start + .31);
    });
    setTimeout(() => ctx.close(), 1400);
  } catch { /* el navegador volverá a intentarlo en el siguiente ciclo */ }
}

export default function PantallaPublica() {
  const params = useParams<{ sede: string }>();
  const rawBranch = String(params.sede || "").trim().toUpperCase();
  const code = rawBranch === "OLIVOS" ? "OLI" : rawBranch === "LOS-OLIVOS" ? "OLI" : rawBranch;
  const [state, setState] = useState<QueueState | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [justCalled, setJustCalled] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceTestMode, setVoiceTestMode] = useState<boolean | null>(null);
  const previousCodes = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const voiceEnabledRef = useRef(true);
  const announcedCodes = useRef<Set<string>>(new Set());
  const announcementAudio = useRef<HTMLAudioElement | null>(null);

  async function announceTicket(ticket: TicketOnScreen) {
    const announcementId = `${ticket.code}|${ticket.startedAt || ""}`;
    if (announcedCodes.current.has(announcementId)) return;
    announcedCodes.current.add(announcementId);
    try {
      const query = new URLSearchParams({ branch: code, ticket: ticket.code });
      if (ticket.testOnly) query.set("test", "1");
      const response = await fetch(`/api/public/announcement?${query}`, { cache: "no-store" });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || `No se pudo generar la voz (${response.status}).`);
      }
      const audioUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrl);
      announcementAudio.current?.pause();
      announcementAudio.current = audio;
      audio.onended = () => URL.revokeObjectURL(audioUrl);
      audio.onerror = () => URL.revokeObjectURL(audioUrl);
      await audio.play();
      setVoiceError(null);
    } catch (error) {
      announcedCodes.current.delete(announcementId);
      setVoiceError(error instanceof Error ? error.message : "No se pudo reproducir la voz.");
      attentionChime();
    }
  }

  function enableVoice() {
    voiceEnabledRef.current = true;
    setVoiceEnabled(true);
    // El gesto del usuario desbloquea la reproducción de audio en navegadores de TV.
    attentionChime();
    setVoiceError(null);
    if (callingTickets.length) announceTicket(callingTickets[0]);
  }

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setVoiceTestMode(new URLSearchParams(window.location.search).get("pruebaVoz") === "1");
  }, []);

  useEffect(() => {
    if (voiceTestMode === null) return;
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch(`/api/public/queue?code=${encodeURIComponent(code)}`, { cache: "no-store" });
        const json = await response.json();
        if (cancelled) return;
        if (!response.ok) { setState({ branch: null, calling: [], waitingCount: 0, nextTickets: [], recentlyCompleted: [], error: json.error }); return; }
        const currentCodes = new Set<string>(json.calling.map((ticket: TicketOnScreen) => ticket.code));
        if (!voiceTestMode && !firstLoad.current) {
          const fresh = json.calling.find((ticket: TicketOnScreen) => !previousCodes.current.has(ticket.code));
          if (fresh) {
            setJustCalled(fresh.code);
            setTimeout(() => setJustCalled(null), 5500);
            if (voiceEnabledRef.current) void announceTicket(fresh);
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
  }, [code, voiceTestMode]);

  const testTicket: TicketOnScreen = {
    code: "PRUEBA-VOZ",
    isPreferential: false,
    displayName: "Cliente de prueba",
    module: 1,
    testOnly: true,
    service: { name: "Prueba de audio · no se registra" },
  };
  const callingTickets = voiceTestMode === true ? [testTicket] : state?.calling.slice(0, 3) || [];
  const callingSignature = callingTickets.map((ticket) => ticket.code).join("|");
  useEffect(() => {
    if (voiceEnabled && callingTickets.length) void announceTicket(callingTickets[0]);
  }, [voiceEnabled, callingSignature]);
  useEffect(() => {
    if (!callingSignature) return;
    attentionChime();
    const repeat = setInterval(attentionChime, 4800);
    return () => clearInterval(repeat);
  }, [callingSignature]);

  if (state?.error) return <main className="screen-page"><p className="screen-error">{state.error}</p></main>;

  const upcoming = state?.nextTickets || [];
  const date = now?.toLocaleDateString("es-PE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) || "Cargando fecha…";
  const time = now?.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) || "--:--";

  return (
    <main className="screen-page">
      <header className="screen-header">
        <img className="screen-logo" src="/atk-peru-wk.png?v=20261019" alt="ATK Altoque Perú WK" />
        <div className="screen-header-tools">
          <div className="screen-audio-control">
            <button className={`screen-audio-button ${voiceEnabled && !voiceError ? "is-enabled" : ""}`} type="button" onClick={enableVoice} aria-pressed={voiceEnabled} title={voiceError || "Anuncios de turno con voz de ElevenLabs."}>
              {voiceError ? "⚠ Reintentar voz" : "🔊 Voz activada"}
            </button>
            {voiceError && <small className="screen-audio-error" role="alert">{voiceError}</small>}
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
            <div className="call-card-top"><span>{ticket.testOnly ? "🔊 PRUEBA DE VOZ" : "🔊 TURNO ACTUAL"}</span><b>{ticket.module ? `MÓDULO ${ticket.module}` : "LLAMANDO"}</b></div>
            <strong className="call-code">{ticket.code}</strong><h1>{ticket.displayName}</h1><p className="call-service">{ticket.service.name}</p><div className="call-instruction">🔊 <b>{ticket.module ? `Dirígete al módulo ${ticket.module}` : "Acércate para ser atendido"}</b></div>
          </article>
        )) : (
          <article className="call-card current-call"><div className="call-card-top"><span>🔊 TURNOS ACTUALES</span><b>EN ESPERA</b></div><strong className="call-code dim-code">—</strong><h1>Esperando llamado</h1><p className="call-service">El próximo ticket aparecerá aquí</p></article>
        )}
      </section>
      <section className="screen-upcoming"><div className="upcoming-title"><span>{voiceTestMode ? "🧪 MODO DE PRUEBA" : "📋 SIGUIENTES EN SER LLAMADOS"}</span><b>{voiceTestMode ? "Sin cambios en el sistema" : `${state?.waitingCount || 0} en espera`}</b></div><div className="screen-next-list">{voiceTestMode ? <p className="screen-empty">Turno ficticio solo para comprobar el audio. No se guarda ni aparece en la cola.</p> : upcoming.length ? upcoming.map((ticket, index) => <div className="screen-next" key={ticket.code}><i>{index + 1}</i><b>{ticket.code}{ticket.isPreferential && <small className="preferential-badge">Preferencial</small>}</b><span>{ticket.displayName} · {ticket.service.name}</span></div>) : <p className="screen-empty">No hay más tickets en espera.</p>}</div></section>
    </main>
  );
}
