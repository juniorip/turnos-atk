"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LIMA_DISTRICTS } from "@/lib/lima-districts";

type Service = { id: number; name: string };
type Branch = { id: number; name: string; code: string };
type DocumentType = "DNI" | "CE";

const visual: Record<string, { icon: string; className: string; description: string }> = {
  Registro: { icon: "▤", className: "registro", description: "Registro de datos y trámites" },
  Consulta: { icon: "💬", className: "consulta", description: "Realiza consultas generales" },
  Efectivización: { icon: "🪙", className: "efectivo", description: "Cobros y pagos pendientes" },
  "Pago de deuda": { icon: "💳", className: "deuda", description: "Realiza el pago de tus deudas" },
};

export default function RegistroPublico() {
  const params = useParams<{ sede: string }>();
  const code = String(params.sede || "").toUpperCase();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [documentType, setDocumentType] = useState<DocumentType>("DNI");
  const [documentNumber, setDocumentNumber] = useState("");
  const [district, setDistrict] = useState("");
  const [isDistrictOpen, setIsDistrictOpen] = useState(false);
  const districtPickerRef = useRef<HTMLDivElement>(null);
  const [isKeypadOpen, setIsKeypadOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [manualNameAllowed, setManualNameAllowed] = useState(false);
  const [isPreferential, setIsPreferential] = useState(false);
  const [selected, setSelected] = useState<Service | null>(null);
  const [ticket, setTicket] = useState<any>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lookupGeneration = useRef(0);
  const verifiedDocument = useRef<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/branch?code=${encodeURIComponent(code)}`).then(r => r.json()).then(result => {
      if (result.branch) { setBranch(result.branch); setServices(result.services); }
      else setError(result.error || "Sede no disponible.");
    }).catch(() => setError("No se pudo conectar."));
  }, [code]);
  useEffect(() => { setNow(new Date()); const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (!ticket) return; const id = setTimeout(reset, 12000); return () => clearTimeout(id); }, [ticket]);
  useEffect(() => {
    if (!isDistrictOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (!districtPickerRef.current?.contains(event.target as Node)) setIsDistrictOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDistrictOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, [isDistrictOpen]);
  useEffect(() => {
    const complete = documentType === "DNI" ? /^\d{8}$/.test(documentNumber) : /^\d{9}$/.test(documentNumber);
    if (complete) lookup(documentNumber, documentType);
  }, [documentNumber, documentType]);

  async function lookup(value: string, type = documentType) {
    const valid = type === "DNI" ? /^\d{8}$/.test(value) : /^\d{9}$/.test(value);
    if (!valid) return;
    const generation = ++lookupGeneration.current;
    verifiedDocument.current = null;
    setBusy(true); setError(""); setFullName("");
    try {
      const response = await fetch("/api/dni", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document: value, documentType: type }) });
      const result = await response.json().catch(() => ({}));
      if (generation !== lookupGeneration.current) return;
      if (!response.ok) { if (type === "CE") setManualNameAllowed(true); setError(type === "CE" ? `${result.error || "No encontramos este documento."} Ingresa el nombre manualmente.` : result.error || "No encontramos este documento."); return; }
      setFullName(result.fullName);
      setManualNameAllowed(false);
      verifiedDocument.current = `${type}:${value}`;
    } catch { if (generation === lookupGeneration.current) { if (type === "CE") setManualNameAllowed(true); setError(type === "CE" ? "No se pudo consultar el CE. Ingresa el nombre manualmente." : "No se pudo consultar el documento."); } }
    finally { if (generation === lookupGeneration.current) setBusy(false); }
  }
  function changeDocument(value: string) {
    ++lookupGeneration.current;
    verifiedDocument.current = null;
    setBusy(false);
    const digits = value.replace(/\D/g, "").slice(0, documentType === "DNI" ? 8 : 9);
    setDocumentNumber(digits); setFullName(""); setManualNameAllowed(false); setError("");
  }
  function appendDocumentDigit(digit: string) {
    const limit = documentType === "DNI" ? 8 : 9;
    if (documentNumber.length >= limit) return;
    const next = `${documentNumber}${digit}`;
    changeDocument(next);
    if (next.length === limit) setIsKeypadOpen(false);
  }
  function removeDocumentDigit() { changeDocument(documentNumber.slice(0, -1)); }
  async function generate(service: Service) {
    const verified = verifiedDocument.current === `${documentType}:${documentNumber}`;
    const manualCE = documentType === "CE" && manualNameAllowed && /^\d{9}$/.test(documentNumber);
    if (!district) { setError("Selecciona el distrito de procedencia para continuar."); return; }
    if (!fullName.trim() || (!verified && !manualCE)) { setError("Completa el nombre y un documento válido para continuar."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/public/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchCode: code, dni: documentNumber, documentType, clientName: fullName, district, isPreferential, serviceId: service.id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.error || "No se pudo generar tu ticket."); return; }
      setTicket(result.ticket);
    } catch { setError("No se pudo generar tu ticket."); }
    finally { setBusy(false); }
  }
  function reset() { ++lookupGeneration.current; verifiedDocument.current = null; setBusy(false); setIsPreferential(false); setDocumentNumber(""); setDistrict(""); setFullName(""); setManualNameAllowed(false); setSelected(null); setTicket(null); setError(""); }

  if (ticket) return <main className="public-page"><section className="public-card success-card"><div className="success-icon">✓</div><h1>¡Ticket generado!</h1><p>Sede {ticket.branch.name}</p><div className="ticket-code">{ticket.code}</div>{ticket.isPreferential && <span className="preferential-badge">Preferencial</span>}<p>Trámite: <b>{ticket.service.name.toUpperCase()}</b></p><p className="wait-copy">Por favor espera a ser llamado por el personal.</p><small>Esta pantalla se reiniciará automáticamente.</small><button onClick={reset}>Registrar otro ticket</button></section></main>;
  if (selected) return <main className="public-page"><section className="public-card service-confirm"><button className="back" onClick={() => setSelected(null)}>← Volver</button><span className="branch-chip">SEDE {branch?.name?.toUpperCase()}</span><h1>Confirmar atención</h1><p className="client-name">Hola, {fullName}</p>{isPreferential && <span className="preferential-badge">Preferencial</span>}<div className={`service-preview ${visual[selected.name]?.className || ""}`}><span>{visual[selected.name]?.icon || "•"}</span><b>{selected.name}</b></div><p>Hora de registro: <b>{now?.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }) || "--:--"}</b></p>{error && <div className="public-error">{error}</div>}<button disabled={busy} onClick={() => generate(selected)}>{busy ? "Generando…" : "Confirmar y generar ticket"}</button></section></main>;
  const documentLength = documentType === "DNI" ? 8 : 9;
  const documentComplete = documentNumber.length === documentLength;
  const documentValidated = Boolean(fullName && verifiedDocument.current === `${documentType}:${documentNumber}`);
  return <main className={`public-page${isKeypadOpen ? " keypad-open" : ""}`}><section className="public-card kiosk-card">
    <span className="branch-chip">⌖ &nbsp; SEDE {branch?.name?.toUpperCase() || "CARGANDO…"}</span>
    <h1>Solicita tu turno</h1><p className="kiosk-intro">Ingresa tu documento para iniciar tu atención.</p>
    <label className="public-label">Tipo de documento<select value={documentType} onChange={event => { const type = event.target.value as DocumentType; ++lookupGeneration.current; verifiedDocument.current = null; setBusy(false); setDocumentType(type); setDocumentNumber(""); setFullName(""); setManualNameAllowed(false); setError(""); setIsKeypadOpen(false); }}><option value="DNI">▣　 DNI</option><option value="CE">▣　 Carnet de Extranjería</option></select></label>
    <label className="public-label">N° de documento<div className={`kiosk-input-wrap ${documentValidated ? "validated" : documentComplete ? "checking" : ""}`}><span className="kiosk-field-icon" aria-hidden="true">▣</span><input value={documentNumber} onChange={event => changeDocument(event.target.value)} onClick={() => setIsKeypadOpen(true)} onFocus={() => setIsKeypadOpen(true)} inputMode="none" readOnly aria-label={`${documentType}, abrir teclado numérico`} aria-expanded={isKeypadOpen} placeholder={documentType === "DNI" ? "Ingresa tu DNI" : "Ingresa tu CE"}/>{documentValidated && <span className="kiosk-valid-check" aria-label="Documento validado">✓</span>}</div>
      {documentValidated && <small className="kiosk-valid-hint">↳　Nombre validado correctamente</small>}
      {busy && documentComplete && <small className="kiosk-status-hint">Consultando documento…</small>}
    </label>
    <div className="public-label district-select-label"><span id="public-district-label">Distrito de procedencia</span><div className="public-district-picker" ref={districtPickerRef}>
      <button type="button" className="public-district-trigger" aria-labelledby="public-district-label" aria-haspopup="listbox" aria-expanded={isDistrictOpen} onClick={() => setIsDistrictOpen(open => !open)}>
        <span className="public-district-pin" aria-hidden="true">⌖</span><span className="public-district-value">{district || "Selecciona tu distrito"}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
      </button>
      {isDistrictOpen && <div className="public-district-menu" role="listbox" aria-labelledby="public-district-label">
        {LIMA_DISTRICTS.map(item => <button type="button" role="option" aria-selected={district === item} className={district === item ? "selected" : ""} key={item} onClick={() => { setDistrict(item); setError(""); setIsDistrictOpen(false); }}>{item}</button>)}
      </div>}
    </div></div>
    {isKeypadOpen && <div className="document-keypad" role="group" aria-label="Teclado numérico para documento"><div className="document-keypad-grid">{["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(digit => <button type="button" className="document-key" key={digit} onClick={() => appendDocumentDigit(digit)}>{digit}</button>)}<button type="button" className="document-key document-key-action" onClick={() => changeDocument("")}>Borrar todo</button><button type="button" className="document-key" onClick={() => appendDocumentDigit("0")}>0</button><button type="button" className="document-key document-key-action" onClick={removeDocumentDigit} aria-label="Borrar último dígito">⌫</button></div><button type="button" className="document-key-done" onClick={() => setIsKeypadOpen(false)}>Listo</button></div>}
    <label className="public-label">Nombre completo<div className={`kiosk-input-wrap kiosk-name-wrap ${documentValidated ? "validated" : ""}`}><span className="kiosk-field-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20c.4-3.4 2.7-5.4 6.5-5.4s6.1 2 6.5 5.4z"/></svg></span><input value={busy && !fullName ? "Consultando…" : fullName} readOnly={!manualNameAllowed || busy} onChange={event => { setFullName(event.target.value); setError(""); }} placeholder={manualNameAllowed ? "Escribe nombres y apellidos" : "Se completará automáticamente"}/>{documentValidated && <span className="kiosk-valid-check" aria-label="Nombre validado">✓</span>}</div>{manualNameAllowed && <small className="kiosk-status-hint">Ingresa el nombre tal como aparece en su documento.</small>}</label>
    <label className="preferential-option"><input type="checkbox" checked={isPreferential} onChange={event => setIsPreferential(event.target.checked)} /><span className="preferential-access-icon" aria-hidden="true">♿</span><span className="preferential-copy"><strong>Atención preferencial</strong><small>Marca esta opción si necesitas atención prioritaria.</small></span></label>
    {error && <div className="public-error">{error}</div>}
    {fullName && <div className="kiosk-services"><h2>Hola, {fullName.split(",")[0]}</h2><p>Selecciona tu tipo de atención:</p><div className="service-grid">{services.map(service => <button className={`service-card ${visual[service.name]?.className || ""}`} onClick={() => setSelected(service)} key={service.id}><span aria-hidden="true">{visual[service.name]?.icon || "•"}</span><span className="service-card-copy"><b>{service.name}</b><small>{visual[service.name]?.description || "Atención y trámites"}</small></span><i aria-hidden="true">›</i></button>)}</div></div>}
    <div className="public-time"><span aria-hidden="true">◷</span> Hora actual: {now?.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) || "--:--:--"}</div>
  </section></main>;
}
