"use client";
import { ChangeEvent, FormEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { debtCommission, effectivizacionCommission, MIN_DEBT_COMMISSION } from "@/lib/effectivizacion";
import { LIMA_DISTRICTS } from "@/lib/lima-districts";
import { appAsset, appFetch } from "@/lib/app-fetch";
import PancakeRegistration, { type PancakeRegistrationStatus } from "./components/pancake-registration";
import PancakeCustomerDetails from "./components/pancake-customer-details";
import BankLogo from "./components/bank-logo";
import type { PancakeDniCustomer } from "@/lib/pancake";
import AutomaticEfectivization from "./components/automatic-efectivization";
import { customerProfile, getRegisteredCards, profileCommissionPlan, type CustomerProfile } from "@/lib/registered-cards";
import { parseAmountCents } from "../public/buscar-cliente-utils.js";
type PreviewWorker = { id: number; name: string; role: string; moduleNumber: number | null; branch?: { name: string } | null };
type BranchComparisonData = {
  branches: { branchId: number; branchName: string; received: number; completed: number; failed: number; cancelled: number; operations: number; volume: number; netVolume: number; profit: number }[];
  services: { branchId: number; branchName: string; service: string; operations: number; tickets: number; volume: number; netVolume: number; profit: number }[];
  banks: { branchId: number; branchName: string; service: string; bank: string; commercialChannel?: string | null; operations: number; volume: number; netVolume: number; profit: number }[];
  trend: { label: string; values: { branchId: number; branchName: string; operations: number; profit: number }[] }[];
};
type DistrictOriginsData = {
  total: number;
  reported: number;
  withoutDistrict: number;
  districts: { district: string; count: number; percentage: number }[];
  branches: { branchId: number; branchName: string; total: number; reported: number; withoutDistrict: number; topDistrict: string | null; topCount: number; topPercentage: number; districts: { district: string; count: number; percentage: number }[] }[];
};
const TAB_AUTH_KEY = "turnos_atk_tab_authenticated";
const REMEMBERED_USERNAME_KEY = "turnos_atk_remembered_username";
type Data = {
  selectedBranchId?: number | null;
  user: { id: number; name: string; role: string; branchId: number | null; branchName?: string | null; moduleNumber?: number | null; availability?: "AVAILABLE" | "PAUSED" | null; multipleAttentionEnabled?: boolean; canSelectWaitingTicket?: boolean };
  stats: {
    waiting: number;
    inService: number;
    completed: number;
    failed: number;
    cancelled: number;
    totalAmount: number;
    totalProfit: number;
    totalTickets: number;
    ownToday: number;
    avgTicket: number;
    avgProfit: number;
    avgWait: number;
    avgAttention: number;
  };
  services: { id: number; name: string }[];
  branches: { id: number; name: string }[];
  banks: { id: number; name: string }[];
  workers?: PreviewWorker[];
  adminPreviewWorkers?: PreviewWorker[];
  workerPerformance: {
    id: number;
    name: string;
    attentions: number;
    failed: number;
    operations: number;
    volume: number;
    profit: number;
    attendanceShare: number;
    avgTicket: number;
    avgProfit: number;
    avgWait: number;
    avgAttention: number;
    services: { service: { name: string } }[];
  }[];
  servicesDistribution: { name: string; count: number; percentage: number; volume: number; profit: number }[];
  commercial: { name: string; tickets: number; operations: number; volume: number; profit: number }[];
  bankPerformance: { bank: string; service: string; commercialChannel?: string | null; operations: number; volume: number; profit: number }[];
  incompleteByService: { name: string; failed: number; cancelled: number }[];
  hourlyDemand: { label: string; tickets: number }[];
  branchPerformance: { id: number; name: string; received: number; completed: number; failed: number; cancelled: number; volume: number; profit: number; avgWait: number; avgAttention: number }[];
  conversions: { consultations: number; toRegistration: number; toEfectivizacion: number; toDebt: number };
  trend: { label: string; tickets: number; completed: number; avgWait: number; avgAttention: number }[];
  quality: { failed: number; cancelled: number; incomplete: number; failedRate: number; escalated: number; recurringClients: number };
  activeTicket?: Ticket | null;
  activeTickets?: Ticket[];
  liveTickets?: Ticket[];
  previewMode?: boolean;
  advisorPresence?: { id: number; name: string; moduleNumber: number | null; status: "FREE" | "OCCUPIED" | "PAUSED" | "UNAVAILABLE"; attentionsToday: number; inLargeRoom?: boolean }[];
  largeRoom?: { branchName: string; active: boolean; isMine: boolean; advisorName: string | null; activeCount: number } | null;
  workerHistory: {
    id: number;
    code: string;
    dni: string;
    clientName: string;
    status: string;
    arrivedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
    notes: string | null;
    service: { name: string };
    operations: { id: number; amount: number; rate: number; profit: number; createdAt: string; commercialChannel?: string | null; service: { name: string }; bank: { id: number; name: string } | null }[];
    history: { id: number; status: string; at: string; actor: { name: string } | null }[];
  }[];
  workerTodayOperations: { id: number; amount: number; profit: number; createdAt: string; service: { name: string } }[];
};
type Ticket = {
  id: number;
  branchId?: number;
  largeRoomId?: number | null;
  code: string;
  dni: string;
  clientName: string;
  isPreferential: boolean;
  status: string;
  arrivedAt: string;
  startedAt?: string;
  branch?: { id: number; name: string };
  service: { id?: number; name: string };
  assignedTo?: { name: string; moduleNumber?: number | null };
};
type TransferAdvisor = { id: number; name: string; moduleNumber: number | null; activeCount: number; acceptsMultiple: boolean };
type OperationDraft = {
  cardKey?: string;
  customerProfile?: CustomerProfile;
  profileDetected?: boolean;
  serviceName: "Efectivización" | "Pago de deuda";
  bankId: number | null;
  amount: string;
  commissionPlan: "ATK_1" | "ATK_0_5" | "ATK_0_35" | "INTERBANK_2" | "INTERBANK_1_5";
  settlementTiming: "NEXT_BUSINESS_DAY" | "SAME_DAY";
  debtRate: string;
  commercialChannel: "POS" | "PAYMENT_LINK" | null;
};
const commissionPlans = [
  { id: "ATK_1", label: "ATK 1%" },
  { id: "ATK_0_5", label: "ATK 0.5%" },
  { id: "ATK_0_35", label: "ATK 0.35%" },
  { id: "INTERBANK_2", label: "Interbank 2%" },
  { id: "INTERBANK_1_5", label: "Interbank 1.5%" },
] as const;
const settlementTimings = [
  { id: "NEXT_BUSINESS_DAY", label: "Siguiente día hábil" },
  { id: "SAME_DAY", label: "Mismo día" },
] as const;
const money = (n: number) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(
    n,
  );
const elapsed = (date: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 1000));
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, "0")} s`;
};
const statusLabels: Record<string, string> = {
  WAITING: "En espera",
  CALLED: "Llamando",
  IN_SERVICE: "En atención",
  COMPLETED: "Finalizado",
  FAILED: "Fallido",
  CANCELLED: "Cancelado",
};
const MAX_ACTIVE_TICKETS = 5;

type NavIconName = "queue" | "home" | "chart" | "team" | "trend" | "settings" | "room" | "ticket" | "history";
function NavIcon({ name }: { name: NavIconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true" {...common}>
    {name === "queue" && <><path d="M3 12h3m3-5v10m4-13v16m4-11v6m4-3h-1" /><circle cx="3" cy="12" r="1" /></>}
    {name === "home" && <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z" /></>}
    {name === "chart" && <><path d="M4 19V10m6 9V5m6 14v-7m5 7H2" /><path d="m3 7 5-3 5 3 7-5" /></>}
    {name === "team" && <><circle cx="9" cy="8" r="3" /><path d="M3 20v-1a6 6 0 0 1 12 0v1zm13-9a3 3 0 1 0-1-5.8M18 14a5 5 0 0 1 3 4.6v1" /></>}
    {name === "trend" && <><path d="m3 17 6-6 4 3 8-9" /><path d="M15 5h6v6" /></>}
    {name === "settings" && <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.3 1-1.4 2.4-1.6-.6a8 8 0 0 1-1.7 1l-.3 1.7h-2.8l-.3-1.7a8 8 0 0 1-1.7-1l-1.6.6L8 16.1l1.3-1a7 7 0 0 1 0-2l-1.3-1 1.4-2.4 1.6.6a8 8 0 0 1 1.7-1l.3-1.7h2.8l.3 1.7a8 8 0 0 1 1.7 1l1.6-.6 1.4 2.4-1.3 1a7 7 0 0 1-.1 1.9Z" /></>}
    {name === "room" && <><path d="M3 21V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v16M2 21h20M8 21v-5h8v5" /><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01" /></>}
    {name === "ticket" && <><path d="M4 5h16v4a3 3 0 0 0 0 6v4H4v-4a3 3 0 0 0 0-6z" /><path d="M12 8v1m0 3v1m0 3v1" /></>}
    {name === "history" && <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5m4-1v5l3 2" /></>}
  </svg>;
}
const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      {statusLabels[status] || status}
    </span>
  );
}
function PreviewWorkerPicker({ workers, value, disabled, onChange }: { workers: PreviewWorker[]; value: string; disabled: boolean; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const selected = workers.find((worker) => String(worker.id) === value);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return <div className="preview-worker-picker" ref={pickerRef}>
    <button type="button" className="preview-worker-trigger" aria-label="Ver colaborador" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      <span>{selected ? `${selected.name} · ${selected.branch?.name || "Sin sede"}` : "Ver colaborador…"}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && <div className="preview-worker-options" role="listbox" aria-label="Colaboradores activos">
      {workers.length ? workers.map((worker) => {
        const id = String(worker.id);
        const isSelected = id === value;
        return <button type="button" role="option" aria-selected={isSelected} className={`preview-worker-option${isSelected ? " selected" : ""}`} key={worker.id} onClick={() => { onChange(id); setOpen(false); }}>
          <span>{worker.name}</span><small>{worker.branch?.name || "Sin sede"}</small>
        </button>;
      }) : <p className="preview-worker-empty">No hay colaboradores activos disponibles.</p>}
    </div>}
  </div>;
}
function DistrictPicker({ name, districts }: { name: string; districts: readonly string[] }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    const form = pickerRef.current?.closest("form");
    const clearOnFormReset = () => setValue("");
    form?.addEventListener("reset", clearOnFormReset);
    return () => form?.removeEventListener("reset", clearOnFormReset);
  }, []);

  return <div className="district-picker" ref={pickerRef}>
    <input type="hidden" name={name} value={value} />
    <button type="button" className="district-picker-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      <span>{value || "Selecciona tu distrito"}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    {open && <div className="district-picker-menu" role="listbox" aria-label="Distritos de Lima">
      {districts.map((district) => <button type="button" role="option" aria-selected={value === district} className={value === district ? "selected" : ""} key={district} onClick={() => { setValue(district); setOpen(false); }}>
        {district}
      </button>)}
    </div>}
  </div>;
}
function ElapsedClock({ since, until }: { since: string; until?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  const end = until ? new Date(until).getTime() : now;
  const seconds = Math.max(0, Math.floor((end - new Date(since).getTime()) / 1000));
  return <>{Math.floor(seconds / 60)} min {String(seconds % 60).padStart(2, "0")} s</>;
}
type ModuleAvailability = { moduleNumber: number; occupiedBy: string | null; isMine: boolean; canTakeover: boolean };
function AdvisorModulePicker({ moduleNumber, onChanged }: { moduleNumber: number | null; onChanged: () => Promise<unknown> }) {
  const [modules, setModules] = useState<ModuleAvailability[]>([]);
  const [serverModule, setServerModule] = useState<number | null>(moduleNumber);
  const [pickerLoading, setPickerLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const loadModules = useCallback(async () => {
    try {
      const response = await appFetch("/api/worker/module", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudieron cargar los módulos.");
      setModules(result.modules || []);
      setServerModule(result.moduleNumber ?? null);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar los módulos.");
    } finally {
      setPickerLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadModules();
    const timer = window.setInterval(() => void loadModules(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadModules]);
  async function chooseModule(event: ChangeEvent<HTMLSelectElement>) {
    const nextModule = Number(event.target.value);
    if (!nextModule || nextModule === serverModule) return;
    const targetModule = modules.find((module) => module.moduleNumber === nextModule);
    if (targetModule?.canTakeover && targetModule.occupiedBy && !window.confirm(`El módulo ${nextModule} está asignado a ${targetModule.occupiedBy}, que no está disponible o aparece desconectado y no tiene clientes llamados ni en atención. ¿Quieres tomar ese módulo?`)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await appFetch("/api/worker/module", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ moduleNumber: nextModule }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo asignar el módulo.");
      setServerModule(result.moduleNumber);
      setNotice(result.reclaimedModuleFrom
        ? `Tomaste el módulo ${result.moduleNumber} de ${result.reclaimedModuleFrom}. Si tenías un cliente, sigue asociado contigo; ya estás disponible.`
        : `Asignado al módulo ${result.moduleNumber}. Si tenías un cliente, sigue asociado contigo; ya estás disponible para nuevos turnos.`);
      await loadModules();
      await onChanged();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo asignar el módulo.");
      await loadModules();
    } finally {
      setSaving(false);
    }
  }
  const statusMessage = saving ? "Cambiando módulo…" : error || notice;
  return <div className="advisor-module-picker">
    <label htmlFor="advisor-module-select">Módulo</label>
    <select id="advisor-module-select" value={serverModule ?? ""} onChange={chooseModule} disabled={pickerLoading || saving} aria-label="Elegir un módulo libre">
      <option value="" disabled>{pickerLoading ? "Cargando módulos…" : "Elige un módulo"}</option>
      {modules.map((module) => <option key={module.moduleNumber} value={module.moduleNumber} disabled={Boolean(module.occupiedBy && !module.isMine && !module.canTakeover)}>
        Módulo {module.moduleNumber}{module.isMine ? " · Mi módulo" : module.canTakeover ? ` · ${module.occupiedBy} (no disponible)` : module.occupiedBy ? ` · ${module.occupiedBy}` : " · Libre"}
      </option>)}
    </select>
    {statusMessage && <span className={error ? "module-picker-error" : "module-picker-note"} role="status" title={error || notice}>{statusMessage}</span>}
  </div>;
}
export default function Home() {
  const refreshGeneration = useRef(0);
  const refreshInFlight = useRef(false);
  const ticketRefreshGeneration = useRef(0);
  const ticketRefreshInFlight = useRef(false);
  const documentGeneration = useRef(0);
  const verifiedDocument = useRef<string | null>(null);
  const knownWaitingTicketIds = useRef<Set<number> | null>(null);
  const notificationAudio = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(true);
  const [browserNotifications, setBrowserNotifications] = useState(false);
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState("");
  const [rememberUsername, setRememberUsername] = useState(false);
  const [loginHelp, setLoginHelp] = useState("");
  const [newTicketNotice, setNewTicketNotice] = useState<Ticket | null>(null);
  const [newTicketNoticeClosing, setNewTicketNoticeClosing] = useState(false);
  const [noticeClosing, setNoticeClosing] = useState(false);
  const [data, setData] = useState<Data | null>(null),
    [sessionReady, setSessionReady] = useState(false),
    [tickets, setTickets] = useState<Ticket[]>([]),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(false),
    [current, setCurrent] = useState<Ticket | null>(null),
    [activeTickets, setActiveTickets] = useState<Ticket[]>([]),
    [multipleAttention, setMultipleAttention] = useState(false),
    [multipleAttentionSaving, setMultipleAttentionSaving] = useState(false),
    [created, setCreated] = useState<Ticket | null>(null),
    [operations, setOperations] = useState<OperationDraft[]>([]),
    [escalation, setEscalation] = useState<
      "REGISTRO" | "CONSULTA" | "EFECTIVIZACION" | "PAGO_DEUDA" | null
    >(null),
    [registrationRequested, setRegistrationRequested] = useState(false),
    [uploadPlatform, setUploadPlatform] = useState<"WEB" | "DRIVE">("WEB"),
    [period, setPeriod] = useState<"today" | "week" | "month">("today"),
    [adminBranchId, setAdminBranchId] = useState(""),
    [rangeFrom, setRangeFrom] = useState(""),
    [rangeTo, setRangeTo] = useState(""),
    [section, setSection] = useState("summary"),
    [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);
  const operationDraftsByTicket = useRef(new Map<number, OperationDraft[]>());
  const currentOperationTicketId = useRef<number | null>(null);
  const discardedOperationDrafts = useRef(new Set<number>());
  const [pancakeRegistration, setPancakeRegistration] = useState<{ ticketId: number; status: PancakeRegistrationStatus } | null>(null);
  const [manualPancakeRegisteredTickets, setManualPancakeRegisteredTickets] = useState<Set<number>>(() => new Set());
  const [pancakeStatusesByTicket, setPancakeStatusesByTicket] = useState<Record<number, PancakeRegistrationStatus>>({});
  const [pancakeCustomer, setPancakeCustomer] = useState<{ ticketId: number; customer: PancakeDniCustomer | null; checkedAt: string | null } | null>(null);
  const pancakeCustomersByTicket = useRef(new Map<number, { customer: PancakeDniCustomer | null; checkedAt: string | null }>());
  const activeTicketsForPancake = useRef(activeTickets);
  const pancakeStatusesForPolling = useRef(pancakeStatusesByTicket);
  const manualTicketsForPolling = useRef(manualPancakeRegisteredTickets);
  const currentTicketForPolling = useRef<number | null>(current?.id ?? null);
  const pancakePollingAllowed = useRef(false);
  const pancakeBatchInFlight = useRef(false);
  activeTicketsForPancake.current = activeTickets;
  pancakeStatusesForPolling.current = pancakeStatusesByTicket;
  manualTicketsForPolling.current = manualPancakeRegisteredTickets;
  currentTicketForPolling.current = current?.id ?? null;
  pancakePollingAllowed.current = Boolean(data && !data.previewMode && ["WORKER", "MANAGER"].includes(data.user.role));
  const handlePancakeCustomer = useCallback((ticketId: number, customer: PancakeDniCustomer | null, checkedAt: string | null) => {
    pancakeCustomersByTicket.current.set(ticketId, { customer, checkedAt });
    if (ticketId === current?.id) setPancakeCustomer({ ticketId, customer, checkedAt });
  }, [current?.id]);
  const handlePancakeStatus = useCallback((ticketId: number, status: PancakeRegistrationStatus) => {
    setPancakeStatusesByTicket((previous) => previous[ticketId] === status ? previous : { ...previous, [ticketId]: status });
    if (ticketId !== current?.id) return;
    setPancakeRegistration({ ticketId, status });
    if (status === "registered" || status === "registered-manual") setRegistrationRequested(false);
  }, [current?.id]);
  useEffect(() => {
    let disposed = false;
    const pollActiveTickets = async () => {
      if (disposed || document.visibilityState !== "visible" || pancakeBatchInFlight.current || !pancakePollingAllowed.current) return;
      if (window.sessionStorage.getItem(TAB_AUTH_KEY) !== "1") return;
      const unresolved = activeTicketsForPancake.current
        .filter((ticket) => ["CALLED", "IN_SERVICE"].includes(ticket.status))
        .filter((ticket) => !manualTicketsForPolling.current.has(ticket.id))
        .filter((ticket) => !["registered", "registered-manual", "loading"].includes(pancakeStatusesForPolling.current[ticket.id] || ""))
        .map((ticket) => ticket.id);
      if (!unresolved.length) return;
      pancakeBatchInFlight.current = true;
      try {
        const response = await appFetch("/api/tickets/pancake-refresh-active", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketIds: unresolved }),
          cache: "no-store",
          signal: AbortSignal.timeout(55_000),
        });
        if (!response.ok || disposed) return;
        const payload = await response.json();
        for (const ticket of payload.tickets || []) {
          if (ticket.state !== "ready" || !ticket.result) continue;
          const result = ticket.result as { ok: boolean; found?: boolean; complete?: boolean; customer?: PancakeDniCustomer | null };
          const status: PancakeRegistrationStatus = !result.ok
            ? "unavailable"
            : result.found
              ? "registered"
              : result.complete
                ? "not-found"
                : "incomplete";
          const ticketId = Number(ticket.ticketId);
          setPancakeStatusesByTicket((previous) => previous[ticketId] === status ? previous : { ...previous, [ticketId]: status });
          const checkedAt = ticket.checkedAt || null;
          pancakeCustomersByTicket.current.set(ticketId, { customer: result.customer || null, checkedAt });
          if (currentTicketForPolling.current === ticketId) {
            setPancakeRegistration({ ticketId, status });
            setPancakeCustomer({ ticketId, customer: result.customer || null, checkedAt });
            if (status === "registered") setRegistrationRequested(false);
          }
        }
      } catch {
        // A transient network failure will be retried on the next minute.
      } finally {
        pancakeBatchInFlight.current = false;
      }
    };
    const timer = window.setInterval(() => void pollActiveTickets(), 60_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  const handleManualPancakeRegisteredChange = useCallback((ticketId: number, registered: boolean) => {
    setManualPancakeRegisteredTickets((previous) => {
      const next = new Set(previous);
      if (registered) next.add(ticketId);
      else next.delete(ticketId);
      return next;
    });
  }, []);
  const canRegisterCurrentClient = pancakeRegistration?.ticketId === current?.id && pancakeRegistration?.status === "not-found";
  const [roomActionLoading, setRoomActionLoading] = useState(false);
  const [selectedRoomTicketIds, setSelectedRoomTicketIds] = useState<number[]>([]);
  const [roomAssignLoading, setRoomAssignLoading] = useState(false);
  const [previewUserId, setPreviewUserId] = useState("");
  const [previewSwitching, setPreviewSwitching] = useState(false);
  const [previewTargetName, setPreviewTargetName] = useState("");
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  const [adminPreviewWorkers, setAdminPreviewWorkers] = useState<NonNullable<Data["workers"]>>([]);
  const [adminBranchSwitching, setAdminBranchSwitching] = useState(false);
  const hasSession = Boolean(data);

  useEffect(() => {
    const rememberedUsername = window.localStorage.getItem(REMEMBERED_USERNAME_KEY);
    if (rememberedUsername) {
      setUsername(rememberedUsername);
      setRememberUsername(true);
    }
  }, []);

  useEffect(() => {
    if (!message || !data) return;
    setNoticeClosing(false);
    const closeAnimation = window.setTimeout(() => setNoticeClosing(true), 4_600);
    const dismiss = window.setTimeout(() => setMessage(""), 4_850);
    return () => {
      window.clearTimeout(closeAnimation);
      window.clearTimeout(dismiss);
    };
  }, [message, hasSession]);

  useEffect(() => {
    setBrowserNotifications(typeof Notification !== "undefined" && Notification.permission === "granted");
  }, []);

  useEffect(() => {
    if (!data || typeof Notification === "undefined") return;
    if (data.previewMode) { setShowNotificationPrompt(false); return; }
    setShowNotificationPrompt(Notification.permission === "default");
  }, [data?.user.id, data?.previewMode]);

  async function enableBrowserNotifications() {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    const enabled = permission === "granted";
    setBrowserNotifications(enabled);
    setShowNotificationPrompt(false);
    setMessage(enabled ? "Notificaciones activadas para los nuevos tickets." : "No se activaron las notificaciones del navegador.");
  }

  useEffect(() => {
    if (!newTicketNotice) return;
    setNewTicketNoticeClosing(false);
    const closeAnimation = window.setTimeout(() => setNewTicketNoticeClosing(true), 9_600);
    const dismiss = window.setTimeout(() => setNewTicketNotice(null), 9_850);
    return () => {
      window.clearTimeout(closeAnimation);
      window.clearTimeout(dismiss);
    };
  }, [newTicketNotice]);

  useEffect(() => {
    const unlockAudio = () => {
      if (notificationAudio.current) return;
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return;
      notificationAudio.current = new AudioContextClass();
      void notificationAudio.current.resume();
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  function playNewTicketSound() {
    if (!soundEnabledRef.current || !notificationAudio.current) return;
    const context = notificationAudio.current;
    if (context.state !== "running") return;
    const now = context.currentTime;
    [880, 1175].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = now + index * 0.16;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.23);
    });
  }

  const refresh = useCallback(async () => {
    // A session cookie is shared by every tab. Require an explicit login in
    // each tab while letting a reload in that same tab keep its session.
    if (window.sessionStorage.getItem(TAB_AUTH_KEY) !== "1") {
      setData(null);
      setCurrent(null);
      setActiveTickets([]);
      setTickets([]);
      setSessionReady(true);
      return false;
    }
    if (refreshInFlight.current) return false;
    refreshInFlight.current = true;
    try {
    const generation = ++refreshGeneration.current;
    const isSummarySection = section === "summary";
    const range = new URLSearchParams({ period: isSummarySection ? "today" : period });
    if (adminBranchId) range.set("branchId", adminBranchId);
    if (!isSummarySection && rangeFrom) range.set("from", rangeFrom);
    if (!isSummarySection && rangeTo) range.set("to", rangeTo);
    let response: Response;
    try {
      response = await appFetch(`/api/dashboard?${range}`, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
    } catch {
      if (generation === refreshGeneration.current) {
        setAdminBranchSwitching(false);
        setMessage("No se pudo comprobar la sesión o cargar la información. Se reintentará automáticamente.");
      }
      return false;
    }
    if (generation !== refreshGeneration.current) return false;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        window.sessionStorage.removeItem(TAB_AUTH_KEY);
        setData(null);
        setCurrent(null);
        setActiveTickets([]);
        setTickets([]);
        setSessionReady(true);
      } else {
        setMessage("No se pudo actualizar la información. Se reintentará automáticamente.");
      }
      setAdminBranchSwitching(false);
      return false;
    }
    const next = await response.json();
    if (generation !== refreshGeneration.current) return false;
    setSessionReady(true);
    if (next.previewMode) {
      setSessionRole("ADMIN");
      setAdminPreviewWorkers(next.adminPreviewWorkers || []);
      setPreviewUserId(String(next.user.id));
    } else {
      setSessionRole(next.user.role);
      if (next.user.role === "ADMIN") setAdminPreviewWorkers(next.adminPreviewWorkers || (next.workers || []).filter((worker: NonNullable<Data["workers"]>[number]) => worker.role === "WORKER" || worker.role === "MANAGER"));
    }
    setData(next);
    setMultipleAttention(Boolean(next.user.multipleAttentionEnabled));
    setTickets((next.liveTickets || []) as Ticket[]);
    const nextActive = (next.activeTickets || (next.activeTicket ? [next.activeTicket] : [])) as Ticket[];
    setActiveTickets(nextActive);
    setCurrent((previous) => nextActive.find((ticket) => ticket.id === previous?.id) || nextActive[0] || null);
    if (generation === refreshGeneration.current) setAdminBranchSwitching(false);
    return true;
    } finally {
      refreshInFlight.current = false;
    }
  }, [period, rangeFrom, rangeTo, browserNotifications, adminBranchId, section]);
  const refreshLiveTickets = useCallback(async () => {
    if (window.sessionStorage.getItem(TAB_AUTH_KEY) !== "1") return false;
    if (ticketRefreshInFlight.current) return false;
    ticketRefreshInFlight.current = true;
    const generation = ++ticketRefreshGeneration.current;
    try {
      const query = new URLSearchParams();
      if (data?.user.role === "ADMIN" && adminBranchId) query.set("branchId", adminBranchId);
      const response = await appFetch(`/api/tickets${query.size ? `?${query}` : ""}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return false;
      const result = await response.json();
      if (generation !== ticketRefreshGeneration.current) return false;
      const nextTickets = (result.tickets || []) as Ticket[];
      // If the dashboard's same-scope count says clients are waiting, don't let
      // a mismatched secondary response erase the authoritative live list.
      if (nextTickets.length === 0 && (data?.stats.waiting || 0) > 0) return false;
      const canReceiveSound = !data?.previewMode && ["WORKER", "MANAGER"].includes(data?.user.role || "");
      const waitingIds = new Set(nextTickets.filter((ticket) => ticket.status === "WAITING").map((ticket) => ticket.id));
      const previousIds = knownWaitingTicketIds.current;
      const newWaiting = canReceiveSound && previousIds
        ? nextTickets.filter((ticket) => ticket.status === "WAITING" && !previousIds.has(ticket.id))
        : [];
      if (newWaiting.length) {
        const newest = newWaiting[0];
        playNewTicketSound();
        setNewTicketNotice(newest);
        if (browserNotifications && Notification.permission === "granted" && (document.visibilityState !== "visible" || !document.hasFocus())) {
          const extra = newWaiting.length > 1 ? " y " + (newWaiting.length - 1) + " más" : "";
          const notification = new Notification("Nuevo ticket por atender", {
            body: newest.code + " · " + newest.clientName + " · " + newest.service.name + extra,
            tag: "turnos-ticket-" + newest.id,
            icon: appAsset("/icons/turnos-192.png?v=20261019"),
          });
          notification.onclick = () => { window.focus(); setSection("queue"); notification.close(); };
        }
      }
      knownWaitingTicketIds.current = canReceiveSound ? waitingIds : null;
      setTickets(nextTickets);
      return true;
    } catch {
      return false;
    } finally {
      ticketRefreshInFlight.current = false;
    }
  }, [adminBranchId, browserNotifications, data?.previewMode, data?.stats.waiting, data?.user.role]);
  useEffect(() => {
    const nextTicketId = current?.id ?? null;
    const previousTicketId = currentOperationTicketId.current;
    if (previousTicketId === nextTicketId) {
      if (nextTicketId !== null) operationDraftsByTicket.current.set(nextTicketId, operations);
      return;
    }
    if (previousTicketId !== null) {
      if (discardedOperationDrafts.current.has(previousTicketId)) {
        operationDraftsByTicket.current.delete(previousTicketId);
        discardedOperationDrafts.current.delete(previousTicketId);
      } else {
        operationDraftsByTicket.current.set(previousTicketId, operations);
      }
    }
    currentOperationTicketId.current = nextTicketId;
    const restoredOperations = nextTicketId === null ? [] : operationDraftsByTicket.current.get(nextTicketId) || [];
    setOperations(restoredOperations);
    setEscalation(null);
    setRegistrationRequested(false);
    setUploadPlatform("WEB");
  }, [current?.id, operations]);
  useEffect(() => {
    const ticketId = current?.id;
    const savedCustomer = ticketId === undefined ? undefined : pancakeCustomersByTicket.current.get(ticketId);
    setPancakeCustomer(savedCustomer && ticketId !== undefined ? { ticketId, ...savedCustomer } : null);
  }, [current?.id]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("sso") !== "complete") return;
    window.sessionStorage.setItem(TAB_AUTH_KEY, "1");
    url.searchParams.delete("sso");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      if (!document.hidden) {
        try { await refresh(); } catch { /* refresh reports recoverable errors in the UI */ }
      }
      if (!stopped) timer = window.setTimeout(poll, 30_000);
    };
    // The dashboard aggregates historical and financial data, so refresh it
    // less often than the live queue to avoid overloading the database. Hidden
    // tabs pause polling and refresh as soon as the advisor returns.
    const onVisibilityChange = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      if (!document.hidden) await refreshLiveTickets();
      if (!stopped) timer = window.setTimeout(poll, 5000);
    };
    const onVisibilityChange = () => {
      if (!document.hidden) void refreshLiveTickets();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();
    return () => {
      stopped = true;
      ++ticketRefreshGeneration.current;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refreshLiveTickets]);
  useEffect(() => {
    if (!sessionReady || data) return;
    window.location.replace(appAsset("/api/auth/portal"));
  }, [sessionReady, data]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const f = new FormData(event.currentTarget);
      const r = await appFetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: f.get("username"),
          password: f.get("password"),
        }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMessage(
          json.error ||
            "No se pudo iniciar sesión. Verifica que la base de datos esté conectada.",
        );
        return;
      }
      window.sessionStorage.setItem(TAB_AUTH_KEY, "1");
      if (rememberUsername) window.localStorage.setItem(REMEMBERED_USERNAME_KEY, String(f.get("username") || "").trim());
      else window.localStorage.removeItem(REMEMBERED_USERNAME_KEY);
      setSessionReady(false);
      await refresh();
    } catch {
      setMessage("No se pudo conectar con el servidor local.");
    } finally {
      setLoading(false);
    }
  }
  async function findDni(event: FormEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const generation = ++documentGeneration.current;
    verifiedDocument.current = null;
    const docNumber = event.currentTarget.value.trim(),
      documentType = (document.querySelector<HTMLSelectElement>(
        'select[name="documentType"]',
      )?.value || "DNI") as "DNI" | "CE";
    if (documentType === "DNI" && !/^\d{8}$/.test(docNumber)) return;
    if (documentType === "CE" && !/^\d{6,12}$/.test(docNumber)) return;
    const nameInput = document.querySelector<HTMLInputElement>(
      'input[name="clientName"]',
    );
    if (nameInput) nameInput.value = "";
    try {
      const r = await appFetch("/api/dni", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document: docNumber, documentType }),
      });
      const json = await r.json();
      if (generation !== documentGeneration.current || input.value.trim() !== docNumber) return;
      if (!r.ok) {
        setMessage(json.error);
        return;
      }
      if (nameInput) nameInput.value = json.fullName;
      verifiedDocument.current = `${documentType}:${docNumber}`;
      setMessage(
        `Nombre completado desde ${documentType === "DNI" ? "RENIEC" : "Extranjería"}.`,
      );
    } catch {
      if (generation !== documentGeneration.current) return;
      setMessage("No se pudo consultar el documento en este momento.");
    }
  }
  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setLoading(true);
    try {
      const f = new FormData(form);
      if (!f.get("district")) {
        setMessage("Selecciona el distrito de procedencia del cliente.");
        return;
      }
      if (verifiedDocument.current !== `${f.get("documentType") || "DNI"}:${f.get("dni")}`) {
        setMessage("Consulta el documento actual antes de generar el ticket.");
        return;
      }
      const r = await appFetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dni: f.get("dni"),
          documentType: f.get("documentType") || "DNI",
          isPreferential: f.get("isPreferential") === "on",
          clientName: f.get("clientName"),
          district: f.get("district"),
          serviceId: Number(f.get("serviceId")),
          phone: f.get("phone") || undefined,
          notes: f.get("notes") || undefined,
          branchId: f.get("branchId") ? Number(f.get("branchId")) : undefined,
        }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMessage(json.error || "No se pudo generar el ticket.");
        return;
      }
      form.reset();
      verifiedDocument.current = null;
      setCreated(json.ticket);
      setMessage(`Ticket ${json.ticket.code} generado correctamente.`);
      await refresh();
    } catch {
      setMessage("No se pudo conectar al generar el ticket.");
    } finally {
      setLoading(false);
    }
  }
  async function toggleMultipleAttention() {
    if (multipleAttentionSaving) return;
    const enabled = !multipleAttention;
    setMultipleAttentionSaving(true);
    try {
      const response = await appFetch("/api/worker/multiple-attention", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "No se pudo guardar Atención múltiple.");
      setMultipleAttention(Boolean(result.enabled));
      setMessage(result.enabled ? "Atención múltiple activada. Puedes recibir derivaciones si tienes cupo." : "Atención múltiple desactivada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar Atención múltiple.");
    } finally {
      setMultipleAttentionSaving(false);
    }
  }

  async function claim() {
    setLoading(true);
    try {
      const r = await appFetch(`/api/queue/claim${multipleAttention ? "?multiple=1" : ""}`, { method: "POST" });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMessage(json.error || "No se pudo llamar el siguiente ticket.");
        return;
      }
      if (json.assignedTo?.id !== data?.user.id) {
        setMessage(`${json.ticket.code} fue asignado a ${json.assignedTo?.name || "otro asesor"} para equilibrar las atenciones.`);
        await refresh();
        return;
      }
      setCurrent(json.ticket);
      setEscalation(null);
      setRegistrationRequested(false);
      setUploadPlatform("WEB");
      setMessage(`${json.ticket.code} está siendo llamado en la pantalla. Confirma cuando se acerque.`);
      await refresh();
    } catch {
      setMessage("No se pudo conectar al llamar el siguiente ticket. Inténtalo nuevamente.");
    } finally {
      setLoading(false);
    }
  }
  async function claimSelected(ticket: Ticket) {
    if (!data?.user.canSelectWaitingTicket || loading || selectedClaimId !== null) return;
    if (multipleAttention && activeTickets.length >= MAX_ACTIVE_TICKETS) {
      setMessage(`Ya tienes el máximo de ${MAX_ACTIVE_TICKETS} tickets activos. Finaliza o deriva uno antes de llamar otro.`);
      return;
    }
    if ((current?.status === "CALLED" || current?.status === "IN_SERVICE") && !multipleAttention) {
      setMessage(current.status === "CALLED"
        ? "Confirma primero si el cliente llamado se acercó."
        : "Activa Atención múltiple antes de asignarte otro turno.");
      return;
    }
    setSelectedClaimId(ticket.id);
    try {
      const response = await appFetch(`/api/queue/claim-selected/${ticket.id}${multipleAttention ? "?multiple=1" : ""}`, { method: "POST" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(json.error || "No se pudo asignar el ticket.");
        await refresh();
        return;
      }
      setCurrent(json.ticket);
      setEscalation(null);
      setRegistrationRequested(false);
      setUploadPlatform("WEB");
      setMessage(`${json.ticket.code} fue asignado a ti y está siendo llamado en la pantalla. Confirma cuando se acerque.`);
      await refresh();
    } catch {
      setMessage("No se pudo conectar al asignar el ticket. Inténtalo nuevamente.");
    } finally {
      setSelectedClaimId(null);
    }
  }

  async function toggleLargeRoom() {
    if (!data || roomActionLoading) return;
    const leaving = Boolean(data.largeRoom?.active && data.largeRoom.isMine);
    setRoomActionLoading(true);
    try {
      const response = await appFetch("/api/worker/large-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: leaving ? "deactivate" : "activate" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.error || "No se pudo actualizar la sala grande.");
        return;
      }
      setMessage(leaving
        ? "Saliste de la sala grande. Tus clientes siguen asignados a ti en tu módulo."
        : "Activaste la sala grande. Elige clientes en espera para atenderlos desde aquí.");
      setSelectedRoomTicketIds([]);
      if (!leaving) setSection("queue");
      await refresh();
    } catch {
      setMessage("No se pudo conectar para actualizar la sala grande.");
    } finally {
      setRoomActionLoading(false);
    }
  }
  async function assignLargeRoomClients() {
    if (!data?.largeRoom?.isMine || !selectedRoomTicketIds.length || roomAssignLoading) return;
    setRoomAssignLoading(true);
    try {
      const response = await appFetch("/api/worker/large-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", ticketIds: selectedRoomTicketIds }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.error || "No se pudieron añadir los clientes a la sala.");
        await refresh();
        return;
      }
      setSelectedRoomTicketIds([]);
      setMessage(`${result.assigned} cliente(s) añadido(s) a tu sala grande.`);
      await refresh();
    } catch {
      setMessage("No se pudo conectar para añadir clientes a la sala grande.");
    } finally {
      setRoomAssignLoading(false);
    }
  }
  async function onManagerTicketTransferred(ticket: Ticket, advisorName: string) {
    if (current?.id === ticket.id) {
      discardedOperationDrafts.current.add(ticket.id);
      setCurrent(null);
    }
    setMessage(`${ticket.code} fue transferido a ${advisorName}.`);
    await refresh();
  }
  async function setAvailability(availability: "AVAILABLE" | "PAUSED") {
    setLoading(true);
    try {
      const response = await appFetch("/api/worker/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ availability }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) { setMessage(json.error || "No se pudo cambiar tu disponibilidad."); return; }
      setMessage(availability === "AVAILABLE" ? "Estás disponible para recibir turnos." : "Te marcaste en pausa. No recibirás nuevas asignaciones.");
      await refresh();
    } catch { setMessage("No se pudo actualizar tu disponibilidad."); }
    finally { setLoading(false); }
  }
  async function changePreviewUser(id: string) {
    if (id === previewUserId || previewSwitching) return;
    setPreviewTargetName(id ? adminPreviewWorkers.find((worker) => String(worker.id) === id)?.name || "el colaborador" : "la cuenta administradora");
    setPreviewSwitching(true);
    try {
      if (isPreviewMode) {
        const stopped = await appFetch("/api/admin/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop" }) });
        if (!stopped.ok) throw new Error("No se pudo volver a la sesión del administrador.");
      }
      if (id) {
        const response = await appFetch("/api/admin/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", workerId: Number(id) }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "No se pudo abrir la sesión del colaborador.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cambiar de sesión.");
      setPreviewSwitching(false);
      setPreviewTargetName("");
      return;
    }
    knownWaitingTicketIds.current = null;
    setPreviewUserId(id);
    setSection(id ? "queue" : "summary");
    setCurrent(null);
    setActiveTickets([]);
    setTickets([]);
    try {
      // A periodic dashboard refresh may supersede this request while the new
      // impersonated session is loading. A `false` result can mean "stale" rather
      // than "failed"; refresh() already reports real network/server failures.
      await refresh();
    } catch {
      setMessage("No se pudo cargar la vista seleccionada. Inténtalo nuevamente.");
    } finally {
      setPreviewSwitching(false);
      setPreviewTargetName("");
    }
  }
  async function resolveCall(status: "IN_SERVICE" | "FAILED") {
    if (!current) return;
    if (status === "FAILED" && !confirm(`¿Marcar ${current.code} como fallido porque no se acercó?`)) return;
    setLoading(true);
    try {
      const response = await appFetch(`/api/tickets/${current.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(json.error || "No se pudo actualizar el llamado.");
        return;
      }
      if (status === "FAILED") {
        ++refreshGeneration.current;
        discardedOperationDrafts.current.add(current.id);
        setActiveTickets((previous) => previous.filter((ticket) => ticket.id !== current.id));
        setTickets((previous) => previous.filter((ticket) => ticket.id !== current.id));
        setCurrent(null);
        setMessage(`${current.code} fue marcado como fallido por inasistencia.`);
      } else {
        // Discard any in-flight refresh that still has the ticket as CALLED,
        // then move it out of the queue immediately after the server confirms.
        ++refreshGeneration.current;
        setCurrent(json.ticket);
        setActiveTickets((previous) => previous.map((ticket) => ticket.id === json.ticket.id ? json.ticket : ticket));
        setTickets((previous) => previous.filter((ticket) => ticket.id !== json.ticket.id));
        setMessage(`${current.code} ya está en atención.`);
      }
      void refresh();
    } catch {
      setMessage("No se pudo conectar al actualizar el llamado.");
    } finally {
      setLoading(false);
    }
  }
  async function finish(outcome: "COMPLETED" | "CANCELLED") {
    if (!current) return;
    const successful = outcome === "COMPLETED";
    const cancelled = outcome === "CANCELLED";
    if (cancelled && !confirm("¿Confirmas que el cliente se retiró durante la atención? El ticket quedará cancelado y las operaciones aún no guardadas se descartarán.")) return;
    if (!successful && !cancelled && operations.some(operation => Number(operation.amount) > 0) && !confirm("Marcar fallido descartará las operaciones ingresadas. Si hubo una operación válida, finaliza como exitoso. ¿Descartar operaciones y marcar fallido?")) return;
    let preparedOperations: (Omit<OperationDraft, "amount"> & { amount: number })[] = [];
    if (successful) {
      try {
        const customer = pancakeCustomer?.ticketId === current.id ? pancakeCustomer.customer : null;
        const cards = getRegisteredCards(customer, data?.banks || []);
        preparedOperations = operations.filter(operation => operation.amount.trim() !== "").map(operation => {
          if (operation.serviceName !== "Efectivización") return { ...operation, amount: Number(operation.amount) };
          const card = cards.find(candidate => candidate.key === operation.cardKey && candidate.bankId === operation.bankId);
          const profile = customerProfile(customer) || operation.customerProfile;
          const cents = parseAmountCents(operation.amount);
          if (!card?.bankId || !profile || !cents) throw new Error("Selecciona una tarjeta registrada, confirma el porcentaje e ingresa un monto válido.");
          const bankName = data?.banks.find(bank => bank.id === card.bankId)?.name || "";
          const commissionPlan = profileCommissionPlan(profile, bankName);
          effectivizacionCommission(bankName, cents / 100, commissionPlan, operation.settlementTiming);
          return { ...operation, commissionPlan, amount: cents / 100 };
        }).filter(operation => operation.amount > 0);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Revisa las operaciones antes de finalizar.");
        return;
      }
    }
    setLoading(true);
    setMessage(successful ? "Finalizando atención…" : cancelled ? "Cancelando ticket…" : "Marcando ticket como fallido…");
    try {
      const r = await appFetch(`/api/tickets/${current.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          successful,
          cancelled,
          escalation,
          registerClient: registrationRequested && canRegisterCurrentClient,
          uploadPlatform,
          operations: preparedOperations.map((operation) => ({
            ...operation,
            debtRate: Number(operation.debtRate),
          })),
        }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMessage(json.error || "No se pudo finalizar el ticket. Inténtalo nuevamente.");
        return;
      }
      ++refreshGeneration.current;
      discardedOperationDrafts.current.add(current.id);
      setActiveTickets((previous) => previous.filter((ticket) => ticket.id !== current.id));
      setCurrent(null);
      setOperations([]);
      setEscalation(null);
      setRegistrationRequested(false);
      setUploadPlatform("WEB");
      const integrationMessage =
        successful && json.integration
          ? json.integration.synced
            ? " Enviado a Registros ATK para aprobación."
            : ` Ticket finalizado, pero no se envió a Registros ATK: ${json.integration.reason}`
          : "";
      setMessage(
        `${current.code} fue ${successful ? "finalizado" : cancelled ? "cancelado porque el cliente se retiró durante la atención" : "marcado como fallido"}.${integrationMessage}`,
      );
      await refresh();
    } catch {
      setMessage("No se pudo conectar al finalizar el ticket. Revisa tu conexión e inténtalo nuevamente.");
    } finally {
      setLoading(false);
    }
  }
  if (!data && !sessionReady)
    return (
      <main className="login session-check-screen">
        <div className="login-shell">
          <div className="login-brand">
            <img src={appAsset("/atk-peru-wk.png?v=20261019")} alt="ATK Altoque Perú WK" />
            <p>Sistema de tickets</p>
          </div>
          <section className="login-card session-check-card" role="status" aria-live="polite">
            <span className="session-check-spinner" aria-hidden="true" />
            <p>{message || "Verificando tu sesión…"}</p>
            {message && <button type="button" className="ghost small" onClick={() => void refresh()}>Reintentar</button>}
          </section>
        </div>
      </main>
    );
  if (!data)
    return (
      <main className="login session-check-screen">
        <div className="login-shell">
          <div className="login-brand">
            <img src={appAsset("/atk-peru-wk.png?v=20261019")} alt="ATK Altoque Perú WK" />
            <p>Sistema de tickets</p>
          </div>
          <section className="login-card session-check-card" role="status" aria-live="polite">
            <span className="session-check-spinner" aria-hidden="true" />
            <p>Abriendo el inicio de sesión…</p>
          </section>
        </div>
      </main>
    );
  const isPreviewMode = Boolean(data.previewMode);
  const isAdminSession = sessionRole === "ADMIN";
  const previewSelector = isAdminSession ? <PreviewWorkerPicker workers={adminPreviewWorkers} disabled={previewSwitching} value={previewUserId} onChange={(id) => void changePreviewUser(id)} /> : null;
  const branchSelector = data.user.role === "ADMIN" && !isPreviewMode ? <select className="view-as-select admin-branch-select" aria-label="Sede que administra" disabled={adminBranchSwitching} value={adminBranchId} onChange={(event) => { setAdminBranchSwitching(true); setAdminBranchId(event.target.value); }}>
    <option value="">Todas las sedes</option>
    {data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
  </select> : null;
  const isReception = data.user.role === "RECEPTION",
    isWorker = data.user.role === "WORKER",
    isLeader = ["ADMIN", "MANAGER"].includes(data.user.role),
    canAttend = ["WORKER", "MANAGER"].includes(data.user.role) && Boolean(data.user.moduleNumber);
  const pendingCallCount = activeTickets.filter((ticket) => ticket.status === "CALLED").length;
  const inServiceCount = activeTickets.filter((ticket) => ticket.status === "IN_SERVICE").length;
  const availabilityIndicator = inServiceCount > 0 ? "attending" : data.user.availability === "AVAILABLE" ? "available" : "paused";
  const activeTicketLimitReached = multipleAttention
    ? activeTickets.length >= MAX_ACTIVE_TICKETS
    : pendingCallCount >= 1;
  const isConsultation =
    (current?.service.name === "Consulta" &&
      !["REGISTRO", "EFECTIVIZACION", "PAGO_DEUDA"].includes(escalation || "")) ||
    escalation === "CONSULTA";
  const isRegistration =
    (current?.service.name === "Registro" &&
      registrationRequested &&
      !["CONSULTA", "EFECTIVIZACION", "PAGO_DEUDA"].includes(escalation || "")) ||
    escalation === "REGISTRO";
  const needsRegistrationDecision =
    current?.service.name === "Registro" &&
    !registrationRequested &&
    escalation === null;
  const activeServiceName = escalation === "EFECTIVIZACION"
    ? "Efectivización"
    : escalation === "PAGO_DEUDA"
      ? "Pago de deuda"
      : escalation === "CONSULTA"
        ? "Consulta"
        : escalation === "REGISTRO"
          ? "Registro"
      : current?.service.name;
  const isEfectivizacion = activeServiceName === "Efectivización";
  const isDebt = activeServiceName === "Pago de deuda";
  const availableBanks = isEfectivizacion
    ? data.banks.filter((bank) =>
        ["BCP", "BBVA", "BanBif", "Scotiabank", "Interbank", "CMR", "IO", "Tarjeta Comercial"].includes(
          bank.name,
        ),
      )
    : isDebt
      ? data.banks.filter((bank) =>
          ["BCP", "BBVA", "BanBif", "Scotiabank", "Interbank"].includes(bank.name),
        )
    : data.banks;
  const banksForOperation = (serviceName: OperationDraft["serviceName"]) => serviceName === "Efectivización"
    ? data.banks.filter((bank) => ["BCP", "BBVA", "BanBif", "Scotiabank", "Interbank", "CMR", "IO", "Tarjeta Comercial"].includes(bank.name))
    : data.banks.filter((bank) => ["BCP", "BBVA", "BanBif", "Scotiabank", "Interbank"].includes(bank.name));
  const effectivizationTotals = operations.reduce((totals, operation) => {
    if (operation.serviceName !== "Efectivización") return totals;
    const cents = parseAmountCents(operation.amount);
    if (!cents || !operation.customerProfile) return totals;
    const amount = cents / 100;
    const bank = data.banks.find((candidate) => candidate.id === operation.bankId);
    if (!bank || !Number.isFinite(amount) || amount <= 0) return totals;
    try {
      const commission = effectivizacionCommission(bank.name, amount, profileCommissionPlan(operation.customerProfile, bank.name), operation.settlementTiming).profit;
      return { gross: totals.gross + amount, commission: totals.commission + commission };
    } catch { return totals; }
  }, { gross: 0, commission: 0 });
  return (
    <main className={`app-shell${isWorker ? " worker-home-shell" : isLeader ? " leader-home-shell" : ""}`}>
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand-mark">
          <img src={appAsset("/atk-peru-wk.png?v=20261019")} alt="Altoque Perú WK" />
        </div>
        <div className="side-user">
          <i>{data.user.name.slice(0, 2).toUpperCase()}</i>
          <div>
            <b>{data.user.name}</b>
            <span>
              {data.user.role === "ADMIN"
                ? "Administrador general"
                : isLeader
                  ? "Jefe de sede"
                  : isReception
                    ? "Recepción"
                    : "Atención"}
            </span>
          </div>
        </div>
        <div className="side-section">OPERACIONES</div>
        {canAttend && isLeader && (
          <button
            className={`side-link ${section === "queue" ? "active" : ""}`}
            onClick={() => setSection("queue")}
          >
            <span><NavIcon name="queue" /></span> Mi cola
          </button>
        )}
{isLeader ? (
          <>
            <button className={`side-link ${section === "tracking" ? "active" : ""}`} onClick={() => setSection("tracking")}>
              <span><NavIcon name="trend" /></span> Seguimiento en vivo
            </button>
            <button
              className={`side-link ${section === "summary" ? "active" : ""}`}
              onClick={() => setSection("summary")}
            >
              <span><NavIcon name="home" /></span> Resumen
            </button>
            <button
              className={`side-link ${section === "indicators" || section === "frequent" ? "active" : ""}`}
              onClick={() => setSection("indicators")}
            >
              <span><NavIcon name="chart" /></span> Indicadores
            </button>
            <button
              className={`side-link ${section === "team" ? "active" : ""}`}
              onClick={() => setSection("team")}
            >
              <span><NavIcon name="team" /></span> Equipo
            </button>
            <button
              className={`side-link ${section === "analysis" ? "active" : ""}`}
              onClick={() => setSection("analysis")}
            >
              <span><NavIcon name="trend" /></span> Análisis
            </button>
            {data.user.role === "ADMIN" && (
              <button className={`side-link ${section === "room" ? "active" : ""}`} onClick={() => setSection("room")}>
                <span><NavIcon name="room" /></span> Sala grande
              </button>
            )}
          </>
        ) : (
          <button
            className={`side-link ${section === "summary" ? "active" : ""}`}
            onClick={() => setSection("summary")}
          >
            <span><NavIcon name="home" /></span> Inicio
          </button>
        )}
        {canAttend && !isLeader && (
          <button
            className={`side-link ${section === "queue" ? "active" : ""}`}
            onClick={() => setSection("queue")}
          >
            <span><NavIcon name="queue" /></span> Mi cola
          </button>
        )}
        {canAttend && <button className={`side-link history-link ${section === "history" ? "active" : ""}`} onClick={() => setSection("history")}>
          <span><NavIcon name="history" /></span> Mi historial
        </button>}
        {canAttend && <button
          type="button"
          className="side-link room-sidebar-toggle"
          disabled={roomActionLoading || Boolean(data.largeRoom?.active && !data.largeRoom.isMine)}
          onClick={() => void toggleLargeRoom()}
          title={data.largeRoom?.active && !data.largeRoom.isMine ? `La sala está activa con ${data.largeRoom.advisorName || "otro asesor"}` : undefined}
        >
          <b><NavIcon name="room" />{roomActionLoading ? "Actualizando sala…" : data.largeRoom?.isMine ? "Salir de sala" : data.largeRoom?.active ? `Sala activa · ${data.largeRoom.advisorName || "asesor"}` : "Activar sala"}</b>
          <small>{data.largeRoom?.isMine ? `${data.largeRoom.activeCount} cliente(s) · volver a mi módulo` : data.largeRoom?.active ? "En uso por otro asesor" : "Atiende desde la sala"}</small>
        </button>}
        {isReception && (
          <button
            className="side-link"
            onClick={() =>
              document
                .querySelector(".form-panel")
                ?.scrollIntoView({ behavior: "smooth" })
            }
          >
            <span><NavIcon name="ticket" /></span> Nuevo ticket
          </button>
        )}
        <div className="side-spacer" />
        {canAttend && <section className="advisor-presence-panel" aria-label="Estado de asesores de la sede">
          <div className="advisor-presence-heading"><span>ASESORES</span><b>{data.advisorPresence?.filter((advisor) => advisor.moduleNumber !== null).length || 0}</b></div>
          <div className="advisor-presence-list">
            {(data.advisorPresence || []).filter((advisor) => advisor.moduleNumber !== null).sort((a, b) => (a.moduleNumber || 99) - (b.moduleNumber || 99)).map((advisor) => {
              const name = advisor.name.includes(",") ? advisor.name.split(",").pop()?.trim().split(/\s+/)[0] : advisor.name.trim().split(/\s+/)[0];
              const label = advisor.status === "OCCUPIED" ? "Ocupado" : advisor.status === "FREE" ? "Libre" : advisor.status === "PAUSED" ? "En pausa" : "No disponible";
              const presence = advisor.inLargeRoom ? "En sala" : label;
              return <div className={"advisor-presence-row " + advisor.status.toLowerCase()} key={advisor.id} title={advisor.name}>
                <span className="advisor-presence-dot" aria-label={advisor.inLargeRoom ? `En sala · ${label}` : label} title={advisor.inLargeRoom ? `En sala · ${label}` : label} />
                <div className="advisor-presence-info"><b>{name}</b><small>Módulo {advisor.moduleNumber} · {presence}</small></div>
                <span className="advisor-presence-count"><b>{advisor.attentionsToday}</b><small>atenciones</small></span>
              </div>;
            })}
            {!(data.advisorPresence || []).some((advisor) => advisor.moduleNumber !== null) && <small className="advisor-presence-empty">No hay asesores con módulo asignado.</small>}
          </div>
        </section>}
        {!isPreviewMode && <button
          className="side-link logout"
          onClick={async () => {
            ++refreshGeneration.current;
              window.sessionStorage.removeItem(TAB_AUTH_KEY);
              await appFetch("/api/auth/logout", { method: "POST" });
              ++refreshGeneration.current;
            setData(null);
            setTickets([]);
            setCurrent(null);
          }}
        >
          ↪ Cerrar sesión
        </button>}
      </aside>
      <div className="app">
        {isWorker ? <header className="worker-home-topbar">
          <div className="worker-home-breadcrumb"><span>Operaciones</span><i>/</i><b>{section === "summary" ? "Inicio" : section === "queue" ? "Mi cola" : section === "history" ? "Mi historial" : "Mi atención"}</b></div>
          <div className="worker-home-controls">
            {isPreviewMode ? <><span className="preview-mode-icon" title="Vista de colaborador" aria-label="Vista de colaborador"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.7" /></svg></span>{previewSelector}<span className="last-update">Actualizado {new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</span><button type="button" className="preview-exit" disabled={previewSwitching} onClick={() => void changePreviewUser("")}>Salir de vista</button></> : <><AdvisorModulePicker moduleNumber={data.user.moduleNumber || null} onChanged={refresh} /><span className="status-separator" /><button className={`ghost availability-toggle ${availabilityIndicator}`} disabled={loading || !data.user.moduleNumber} onClick={() => setAvailability(data.user.availability === "AVAILABLE" ? "PAUSED" : "AVAILABLE")}><b aria-hidden="true">●</b> {data.user.moduleNumber ? data.user.availability === "AVAILABLE" ? "Disponible" : "En pausa" : "Elige módulo"}</button></>}
          </div>
        </header> : isLeader ? <header className="dashboard-header leader-home-topbar">
          <div className="leader-home-breadcrumb"><span>Operaciones</span><i>/</i><b>{({ summary: "Resumen", tracking: "Seguimiento en vivo", indicators: "Indicadores", frequent: "Clientes frecuentes", team: "Equipo", analysis: "Análisis", room: "Sala" } as Record<string, string>)[section] || "Operación"}</b></div>
          <div className="header-profile">
            {data.user.role === "ADMIN" && !isPreviewMode && branchSelector}
            {isPreviewMode && <span className="preview-mode-icon" title="Vista de colaborador" aria-label="Vista de colaborador"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.7" /></svg></span>}
            {isAdminSession && previewSelector}
            {data.user.role === "MANAGER" && <AdvisorModulePicker moduleNumber={data.user.moduleNumber || null} onChanged={refresh} />}
            <span className="last-update">Actualizado {new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="header-avatar">{initials(data.user.name)}</span>
            <div><b>{data.user.role === "ADMIN" ? "Administrador General" : "Jefe de sede"}</b><small>{data.user.name}</small></div>
            <span className="profile-caret">⌄</span>
            {data.user.role === "MANAGER" && <button className={`ghost availability-toggle ${availabilityIndicator}`} disabled={loading} onClick={() => setAvailability(data.user.availability === "AVAILABLE" ? "PAUSED" : "AVAILABLE")}><b aria-hidden="true">●</b> {data.user.availability === "AVAILABLE" ? "Disponible" : "En pausa"}</button>}
            {isPreviewMode && <button type="button" className="preview-exit" disabled={previewSwitching} onClick={() => void changePreviewUser("")}>Salir de vista</button>}
          </div>
        </header> : <header className={isLeader ? "dashboard-header" : ""}>
          <button className="mobile-nav-toggle" aria-label="Abrir menú" onClick={() => setSidebarOpen((open) => !open)}>☰</button>
          <div>
            <span className="eyebrow">
              PANEL DE{" "}
              {data.user.role === "ADMIN"
                ? "CONTROL GENERAL"
                : isLeader
                  ? "SEDE"
                  : isReception
                    ? "RECEPCIÓN"
                    : "ATENCIÓN"}
            </span>
            <h1>
              {data.user.role === "ADMIN"
                ? "Visión general"
                : isLeader
                  ? "Operación de tu sede"
                  : isReception
                    ? "Registrar llegada"
                      : section === "queue"
                      ? "Mi cola"
                      : section === "history"
                        ? "Mi historial"
                      : "Mi atención"}
            </h1>
            <p className="header-copy">
              {data.user.name} ·{" "}
              {data.user.role === "ADMIN"
                ? data.branches.find((branch) => branch.id === data.selectedBranchId)?.name || "Todas las sedes"
                : data.user.branchName || (data.user.branchId ? "Sede asignada" : "Todas las sedes")}
              {["WORKER", "MANAGER"].includes(data.user.role) && ` · ${data.user.moduleNumber ? `Módulo ${data.user.moduleNumber}` : "Sin módulo"}`}
            </p>
          </div>
          {isLeader ? (
            <div className="header-profile">
              {data.user.role === "ADMIN" && !isPreviewMode && branchSelector}
              {isAdminSession && previewSelector}
              {data.user.role === "MANAGER" && <AdvisorModulePicker moduleNumber={data.user.moduleNumber || null} onChanged={refresh} />}
              <span className="last-update">Actualizado {new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="header-avatar">{initials(data.user.name)}</span>
              <div><b>{data.user.role === "ADMIN" ? "Administrador General" : "Jefe de sede"}</b><small>{data.user.name}</small></div>
              <span className="profile-caret">⌄</span>
              {canAttend && <button className={`ghost availability-toggle ${availabilityIndicator}`} disabled={loading} onClick={() => setAvailability(data.user.availability === "AVAILABLE" ? "PAUSED" : "AVAILABLE")}><b aria-hidden="true">●</b> {data.user.availability === "AVAILABLE" ? "Disponible" : "En pausa"}</button>}
            </div>
          ) : (
            <div className={isPreviewMode ? "preview-header-controls" : isWorker ? "worker-header-controls" : "status"}>
              {isPreviewMode ? <><span className="preview-mode-icon" title="Vista de colaborador" aria-label="Vista de colaborador"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.7" /></svg></span>{previewSelector}{["WORKER", "MANAGER"].includes(data.user.role) && <AdvisorModulePicker moduleNumber={data.user.moduleNumber || null} onChanged={refresh} />}<button className={`ghost availability-toggle ${availabilityIndicator}`} disabled={loading || previewSwitching || !data.user.moduleNumber} onClick={() => setAvailability(data.user.availability === "AVAILABLE" ? "PAUSED" : "AVAILABLE")}><b aria-hidden="true">●</b> {data.user.moduleNumber ? data.user.availability === "AVAILABLE" ? "Disponible" : "En pausa" : "Elige módulo"}</button><span className="last-update">Actualizado {new Date().toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}</span><button type="button" className="preview-exit" disabled={previewSwitching} onClick={() => void changePreviewUser("")}>Salir de vista</button></>
                : isWorker ? <><AdvisorModulePicker moduleNumber={data.user.moduleNumber || null} onChanged={refresh} /><button className={`ghost availability-toggle ${availabilityIndicator}`} disabled={loading || !data.user.moduleNumber} onClick={() => setAvailability(data.user.availability === "AVAILABLE" ? "PAUSED" : "AVAILABLE")}><b aria-hidden="true">●</b> {data.user.moduleNumber ? data.user.availability === "AVAILABLE" ? "Disponible" : "En pausa" : "Elige módulo"}</button></> : <><b>●</b> Actualización automática</>}
            </div>
          )}
        </header>}
        <div className="app-content">
        {previewSwitching && <div className="preview-loading-overlay" role="status" aria-live="polite"><div className="preview-loading-card"><span className="preview-loading-spinner" aria-hidden="true" /><div><b>Abriendo vista de {previewTargetName || "colaborador"}</b><small>Cargando cola, tickets y datos de atención…</small></div></div></div>}
        {adminBranchSwitching && data.user.role === "ADMIN" && !isPreviewMode && <div className="preview-loading-overlay" role="status" aria-live="polite"><div className="preview-loading-card"><span className="preview-loading-spinner" aria-hidden="true" /><div><b>Cambiando sede…</b><small>Actualizando el resumen, indicadores, equipo y tickets.</small></div></div></div>}
        {!isPreviewMode && newTicketNotice && <div className={`new-ticket-toast${newTicketNoticeClosing ? " is-leaving" : ""}`} role="status" aria-live="polite"><span className="new-ticket-toast-icon">🔔</span><div><b>Nuevo ticket por atender</b><span>{newTicketNotice.code} · {newTicketNotice.clientName}</span><small>{newTicketNotice.service.name}</small></div><button type="button" aria-label="Cerrar notificación" onClick={() => setNewTicketNotice(null)}>×</button></div>}
        {!isPreviewMode && showNotificationPrompt && <div className="notification-prompt" role="status" aria-live="polite"><span className="notification-prompt-icon">🔔</span><div className="notification-prompt-copy"><b>Activa las notificaciones</b><span>Recibe un aviso cuando llegue un nuevo ticket.</span></div><button type="button" className="notification-prompt-activate" onClick={() => void enableBrowserNotifications()}>Activar</button><button type="button" className="notification-prompt-close" aria-label="Cerrar aviso" onClick={() => setShowNotificationPrompt(false)}>×</button></div>}
        {!isLeader && !isWorker && <nav>
          <span>
            {data.user.role === "ADMIN"
              ? "Resumen ejecutivo"
              : isLeader
                ? "Resumen de sede"
                : isReception
                  ? "Tickets digitales"
                : section === "queue"
                  ? "Cola disponible e historial personal"
                  : "Cola de atención"}
          </span>
          <button
            className="ghost mobile-logout"
            onClick={async () => {
              ++refreshGeneration.current;
              window.sessionStorage.removeItem(TAB_AUTH_KEY);
              await appFetch("/api/auth/logout", { method: "POST" });
              ++refreshGeneration.current;
              setData(null);
              setTickets([]);
              setCurrent(null);
            }}
          >
            Salir
          </button>
        </nav>}
        {message && (
          <div className={`notice toast-notice${noticeClosing ? " is-leaving" : ""}`} role="status" aria-live="polite">
            {message}
            <button onClick={() => setMessage("")}>×</button>
          </div>
        )}
        {created && (
          <div className="dialog-backdrop">
            <section className="dialog">
              <span className="eyebrow">TICKET GENERADO CORRECTAMENTE</span>
              <h2>{created.code}</h2>
              {created.isPreferential && <span className="preferential-badge">Preferencial</span>}
              <p>
                <b>Cliente:</b> {created.clientName}
              </p>
              <p>
                <b>Trámite:</b> {created.service?.name}
              </p>
              <p>
                <b>Estado:</b> En espera
              </p>
              <button onClick={() => setCreated(null)}>
                Generar nuevo ticket
              </button>
            </section>
          </div>
        )}
        {isWorker && section === "summary" && <WorkerHomeDashboard data={data} />}
        {isWorker && section === "queue" && <WorkerPageHeading title="Mi cola" data={data} />}
        {!isLeader && !isWorker && <section className="metrics">
          <Metric label="En espera" value={data.stats.waiting} tone="orange" hero />
          <Metric
            label="En atención"
            value={data.stats.inService}
            tone="cyan"
          />
          <Metric
            label="Finalizados hoy"
            value={data.stats.completed}
            tone="green"
          />
          <Metric label="Fallidos hoy" value={data.stats.failed} tone="red" />
          <Metric
            label="Volumen hoy"
            value={money(data.stats.totalAmount)}
            tone="purple"
          />
          <Metric
            label="Utilidad hoy"
            value={money(data.stats.totalProfit)}
            tone="green"
          />
        </section>}
        {isReception && (
          <section className="grid reception">
            <article className="panel form-panel">
              <span className="eyebrow">NUEVA LLEGADA</span>
              <h2>Generar ticket digital</h2>
              <p>
                Al completar los ocho dígitos, el nombre se consulta
                automáticamente y queda protegido contra edición.
              </p>
              <form onSubmit={createTicket} className="form-grid">
                <label>
                  DNI
                  <input
                    name="dni"
                    inputMode="numeric"
                    maxLength={8}
                    onChange={() => {
                      ++documentGeneration.current;
                      verifiedDocument.current = null;
                      const nameInput = document.querySelector<HTMLInputElement>('input[name="clientName"]');
                      if (nameInput) nameInput.value = "";
                    }}
                    onBlur={findDni}
                    required
                  />
                </label>
                <label>
                  Nombre completo
                  <input name="clientName" readOnly required />
                </label>
                <label className="district-field">
                  Distrito de procedencia
                  <DistrictPicker name="district" districts={LIMA_DISTRICTS} />
                </label>
                <label className="preferential-option full"><input type="checkbox" name="isPreferential" /><span>Atención preferencial<small>Se llamará antes de los turnos regulares pendientes.</small></span></label>
                <label>
                  Tipo de trámite
                  <select name="serviceId" required>
                    <option value="">Seleccionar…</option>
                    {data.services.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                {data.user.role === "ADMIN" && (
                  <label>
                    Sede
                    <select name="branchId" required>
                      {data.branches.map((b) => (
                        <option value={b.id} key={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Teléfono <small>opcional</small>
                  <input name="phone" inputMode="tel" />
                </label>
                <label className="full">
                  Observación <small>opcional</small>
                  <textarea name="notes" rows={3} />
                </label>
                <button className="full" disabled={loading}>
                  {loading ? "Generando…" : "Generar ticket"}
                </button>
              </form>
            </article>
            <Queue tickets={tickets} />
          </section>
        )}
        {canAttend && section === "queue" && (
          <section className={data.user.canSelectWaitingTicket ? `grid worker lince-manager-workspace${data.largeRoom?.isMine ? " has-large-room" : ""}` : "grid worker queue-workspace"}>
            {data.largeRoom?.isMine && <LargeRoomAdvisorPicker tickets={tickets.filter((ticket) => ticket.status === "WAITING")} selectedIds={selectedRoomTicketIds} onSelectedIds={setSelectedRoomTicketIds} onAssign={() => void assignLargeRoomClients()} busy={roomAssignLoading} activeCount={data.largeRoom.activeCount} branchName={data.largeRoom.branchName} />}
            <Queue
              tickets={tickets}
              shared
              onAttend={data.user.canSelectWaitingTicket ? claimSelected : undefined}
              attendingTicketId={selectedClaimId}
              attendanceBlocked={loading || (multipleAttention && activeTicketLimitReached) || ((current?.status === "CALLED" || current?.status === "IN_SERVICE") && !multipleAttention)}
            />
            <article className="panel current">
              {(
                <div className="multi-attention">
                  <div className="multi-attention-heading">
                    <div><strong>Atención múltiple</strong><small>{activeTickets.length} ticket(s) activo(s) · máximo {MAX_ACTIVE_TICKETS} simultáneos</small></div>
                    <button type="button" className={multipleAttention ? "multi-toggle active" : "multi-toggle"} onClick={() => void toggleMultipleAttention()} disabled={multipleAttentionSaving}>{multipleAttentionSaving ? "Guardando…" : multipleAttention ? "Desactivar" : "Activar"}</button>
                  </div>
                  {activeTickets.length > 1 && <div className="multi-ticket-list" aria-label="Tickets activos">
                    {activeTickets.map((ticket) => <button type="button" key={ticket.id} className={current?.id === ticket.id ? "multi-ticket selected" : "multi-ticket"} onClick={() => setCurrent(ticket)}><b>{ticket.code}</b><span>{ticket.clientName}</span><small>{statusLabels[ticket.status] || ticket.status}</small></button>)}
                  </div>}
                  {multipleAttention && <div className="multi-call-row">
                    <span>{activeTicketLimitReached ? `Tienes ${activeTickets.length} tickets activos. Finaliza o deriva uno para liberar un cupo.` : current?.status === "IN_SERVICE" || current?.status === "CALLED" ? "Puedes llamar otro cliente mientras tengas un cupo activo." : "Llama al siguiente cliente de la cola compartida."}</span>
                    <button type="button" onClick={claim} disabled={loading || activeTicketLimitReached || data.user.availability !== "AVAILABLE" || (current?.status === "CALLED" && !multipleAttention)}>{loading ? "Llamando…" : activeTicketLimitReached ? "Límite alcanzado" : "Llamar siguiente"}</button>
                  </div>}
                </div>
              )}
              {current ? current.status === "CALLED" ? (
                <div className="called-ticket">
                  <div className="current-attention-meta"><span className="eyebrow">LLAMANDO</span><span>Llegó: {new Date(current.arrivedAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })} · Espera: <ElapsedClock since={current.arrivedAt} until={current.startedAt} /></span></div>
                  <div className="current-client-heading"><div className="current-client-title"><h2>{current.code} · {current.clientName}</h2><TicketTransfer ticketId={current.id} ticketCode={current.code} onTransferred={async (advisorName) => { ++refreshGeneration.current; discardedOperationDrafts.current.add(current.id); setCurrent(null); setMessage(`${current.code} fue transferido a ${advisorName}.`); await refresh(); }} /></div><span className="current-client-dni">DNI {current.dni}</span></div>
                  {current.isPreferential && <span className="preferential-badge">Preferencial</span>}
                  <p>{current.service.name}</p>
                  <p className="called-copy">El ticket seguirá apareciendo y sonando en la TV hasta que confirmes que el cliente se acercó.</p>
                  <div className="current-actions">
                    <button onClick={() => resolveCall("IN_SERVICE")} disabled={loading}>✓ En atención</button>
                    <button className="danger" onClick={() => resolveCall("FAILED")} disabled={loading}>No se acercó · Fallido</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="current-attention-meta"><span className="eyebrow">ATENCIÓN ACTUAL</span><span>Llegó: {new Date(current.arrivedAt).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })} · Espera: <ElapsedClock since={current.arrivedAt} until={current.startedAt} />{current.startedAt && <> · Atención: <ElapsedClock since={current.startedAt} /></>}</span></div>
                  <div className="current-client-heading"><div className="current-client-title"><h2>{current.code} · {current.clientName}</h2><PancakeRegistration key={current.id} ticketId={current.id} manualRegistered={manualPancakeRegisteredTickets.has(current.id)} statusOverride={pancakeStatusesByTicket[current.id]} onManualRegisteredChange={handleManualPancakeRegisteredChange} onStatusChange={handlePancakeStatus} onCustomerChange={handlePancakeCustomer} /><TicketTransfer ticketId={current.id} ticketCode={current.code} onTransferred={async (advisorName) => { ++refreshGeneration.current; discardedOperationDrafts.current.add(current.id); setCurrent(null); setMessage(`${current.code} fue transferido a ${advisorName}.`); await refresh(); }} /></div><span className="current-client-dni">DNI {current.dni}</span></div>
                  {pancakeCustomer?.ticketId === current.id && pancakeCustomer.customer && <PancakeCustomerDetails customer={pancakeCustomer.customer} checkedAt={pancakeCustomer.checkedAt} />}
                  {current.isPreferential && <span className="preferential-badge">Preferencial</span>}
                  <div className="current-service-flow">
                  {isConsultation ? (
                    <div className="ops consultation-actions">
                      <div className="panel-title">
                        <div>
                          <h3>Consulta atendida</h3>
                          <p className="operation-note">
                            Si el cliente decide continuar, escálalo para preparar su registro.
                          </p>
                        </div>
                        <button type="button" className="ghost" onClick={() => { setRegistrationRequested(true); setEscalation("REGISTRO"); }}>
                          ↗ Escalar a registro
                        </button>
                      </div>
                      <div className="current-actions escalation-actions">
                        <button type="button" className="ghost" onClick={() => setEscalation("EFECTIVIZACION")}>Escalar a efectivización</button>
                        <button type="button" className="ghost" onClick={() => setEscalation("PAGO_DEUDA")}>Escalar a pago de deuda</button>
                      </div>
                    </div>
                  ) : needsRegistrationDecision ? (
                    <div className="ops registration-choice">
                      <div className="panel-title">
                        <div>
                          <h3>¿Registrar a este cliente?</h3>
                          <p className="operation-note">
                            Confirma primero si el cliente necesita un registro nuevo. No se enviará ningún dato a Registros ATK hasta que lo confirmes.
                          </p>
                        </div>
                      </div>
                      <div className="current-actions escalation-actions">
                        <button type="button" onClick={() => setRegistrationRequested(true)}>
                          ✓ Sí, registrar cliente
                        </button>
                        <button type="button" className="ghost" onClick={() => setEscalation("CONSULTA")}>
                          Ya está registrado · Atender como consulta
                        </button>
                      </div>
                      <div className="current-actions escalation-actions">
                        <button type="button" className="ghost" onClick={() => setEscalation("EFECTIVIZACION")}>
                          Escalar a efectivización
                        </button>
                        <button type="button" className="ghost" onClick={() => setEscalation("PAGO_DEUDA")}>
                          Escalar a pago de deuda
                        </button>
                      </div>
                    </div>
                  ) : isRegistration ? (
                    <div className="ops registration-escalation">
                      <div className="panel-title">
                        <div>
                          <h3>Completar registro</h3>
                          <p className="operation-note">
                            Se enviará a Registros ATK recién al finalizar este ticket.
                          </p>
                        </div>
                        <button type="button" className="ghost" onClick={() => { setRegistrationRequested(false); setEscalation("CONSULTA"); }}>
                          No registrarlo · Cambiar a consulta
                        </button>
                      </div>
                      <div className="form-grid readonly-record">
                        <label>Nombre del cliente<input readOnly value={current.clientName} /></label>
                        <label>DNI del cliente<input readOnly value={current.dni} /></label>
                        <label>Fecha de registro<input readOnly value={new Date().toLocaleDateString("en-CA")} /></label>
                        <label>Tipo<input readOnly value="Registro (pendiente de operación)" /></label>
                        <label>Modalidad<input readOnly value="Presencial" /></label>
                        <label>
                          Plataforma
                          <select value={uploadPlatform} onChange={(event) => setUploadPlatform(event.target.value as "WEB" | "DRIVE")}>
                            <option value="DRIVE">Drive</option>
                            <option value="WEB">Página web</option>
                          </select>
                        </label>
                      </div>
                      <div className="current-actions escalation-actions">
                        <button type="button" className="ghost" onClick={() => setEscalation("EFECTIVIZACION")}>
                          Escalar a efectivización
                        </button>
                        <button type="button" className="ghost" onClick={() => setEscalation("PAGO_DEUDA")}>
                          Escalar a pago de deuda
                        </button>
                      </div>
                    </div>
                  ) : (
                  <div className="ops">
                    <div className="panel-title operation-panel-title">
                      <div>
                        <h3>Operaciones realizadas</h3>
                      </div>
                      <div className="inline-actions operation-actions">
                        {(isEfectivizacion || isDebt) && canRegisterCurrentClient && <button type="button" className={`registration-state-toggle${registrationRequested ? " is-active" : ""}`} aria-pressed={registrationRequested} onClick={() => setRegistrationRequested((value) => !value)}><span className="registration-state-light" aria-hidden="true" />{registrationRequested ? "Registro activo · se enviará al finalizar" : "Activar registro del cliente"}</button>}
                        <button
                          type="button"
                          className="ghost"
                          onClick={() =>
                            setOperations((rows) => [
                              ...rows,
                              {
                                serviceName: isDebt ? "Pago de deuda" : "Efectivización",
                                bankId: null,
                                amount: "",
                                commissionPlan: availableBanks[0]?.name === "Interbank" ? "INTERBANK_1_5" : "ATK_1",
                                settlementTiming: "NEXT_BUSINESS_DAY",
                                debtRate: "1",
                                commercialChannel: null,
                              },
                            ])
                          }
                        >
                          + Agregar operación
                        </button>
                      </div>
                    </div>
                    {operations.map((op, index) => {
                      const rowIsEfectivizacion = op.serviceName === "Efectivización";
                      const rowBanks = banksForOperation(op.serviceName);
                      return <div className={"operation-row" + (rowIsEfectivizacion ? " effective-operation" : "")} key={index}>
                        <select aria-label={"Tipo de operación " + (index + 1)} value={op.serviceName} onChange={event => {
                          const serviceName = event.target.value as OperationDraft["serviceName"];
                          setOperations(rows => rows.map((row, i) => i === index ? { ...row, serviceName, bankId: null, commercialChannel: null, cardKey: undefined, customerProfile: undefined, profileDetected: false } : row));
                        }}><option value="Efectivización">Efectivización</option><option value="Pago de deuda">Pago de deuda</option></select>
                        {rowIsEfectivizacion ? <AutomaticEfectivization
                          operation={op}
                          customer={pancakeCustomer?.ticketId === current.id ? pancakeCustomer.customer : null}
                          banks={data.banks}
                          index={index}
                          onChange={patch => setOperations(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row))}
                          showQuote={false}
                        /> : <>
                          <DebtCardPicker
                            customer={pancakeCustomer?.ticketId === current.id ? pancakeCustomer.customer : null}
                            banks={rowBanks}
                            selectedKey={op.cardKey}
                            selectedBankId={op.bankId}
                            onSelect={card => setOperations(rows => rows.map((row, i) => i === index ? { ...row, bankId: card.bankId, cardKey: card.key } : row))}
                            onSelectBank={bankId => setOperations(rows => rows.map((row, i) => i === index ? { ...row, bankId, cardKey: undefined } : row))}
                          />
                          <select value={op.debtRate} onChange={event => setOperations(rows => rows.map((row, i) => i === index ? { ...row, debtRate: event.target.value } : row))}>
                            {[1, 1.5, 2, 2.5].map(rate => <option value={rate} key={rate}>{rate}% comisión · mín. S/ {MIN_DEBT_COMMISSION}</option>)}
                          </select>
                          <input type="number" min="0" step="0.01" placeholder="Monto S/" value={op.amount} onChange={event => setOperations(rows => rows.map((row, i) => i === index ? { ...row, amount: event.target.value } : row))} />
                        </>}
                        <button type="button" className="danger small" onClick={() => setOperations(rows => rows.filter((_, i) => i !== index))}>Quitar</button>
                        {!rowIsEfectivizacion && Number(op.amount) > 0 && <p className="operation-preview">Comisión / utilidad: <b>{money(debtCommission(Number(op.amount), Number(op.debtRate)))}</b> · Neto: <b>{money(Math.max(0, Number(op.amount) - debtCommission(Number(op.amount), Number(op.debtRate))))}</b></p>}
                      </div>;
                    })}
                    {effectivizationTotals.gross > 0 && <p className="operation-preview effectivization-total">
                      Total Efectivización · Comisión: <b>{money(effectivizationTotals.commission)}</b> · Neto: <b>{money(effectivizationTotals.gross - effectivizationTotals.commission)}</b>
                    </p>}
                  </div>
                  )}
                  </div>
                  <div className="current-actions">
                    <button onClick={() => finish("COMPLETED")} disabled={loading}>
                      Finalizar exitoso
                    </button>
                    <button
                      className="danger"
                      onClick={() => finish("CANCELLED")}
                      disabled={loading}
                    >
                      Cliente se retiró · Cancelar
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h2>Sin atención activa</h2>
                  <p>
                    Personas atendidas hoy: <b>{data.stats.ownToday}</b>
                  </p>
                  <button onClick={claim} disabled={loading || data.user.availability !== "AVAILABLE"}>
                    {loading ? "Buscando…" : data.user.availability === "AVAILABLE" ? "Llamar siguiente" : "Disponible para llamar"}
                  </button>
                </>
              )}
            </article>
          </section>
        )}
        {canAttend && section === "history" && (
          <section className="worker-history-section worker-history-page">
            {isWorker && <WorkerPageHeading title="Mi historial" data={data} />}
            <WorkerHistory tickets={data.workerHistory} banks={data.banks} onChanged={async (text) => { setMessage(text); await refresh(); }} />
          </section>
        )}
        {isLeader && section === "tracking" && <LiveTickets tickets={tickets} canManage onTransferred={onManagerTicketTransferred} />}
        {isLeader && section !== "queue" && section !== "history" && section !== "tracking" && <Leadership data={data} tickets={data.user.role === "ADMIN" && data.selectedBranchId ? tickets.filter((ticket) => ticket.branchId === data.selectedBranchId) : tickets} selected={section} onSelect={setSection} period={period} onPeriod={(next) => { setRangeFrom(""); setRangeTo(""); setPeriod(next); }} rangeFrom={rangeFrom} rangeTo={rangeTo} onRange={(from, to) => { setRangeFrom(from); setRangeTo(to); }} onTicketTransferred={onManagerTicketTransferred} />}
        </div>
      </div>
    </main>
  );
}
function Metric({
  label,
  value,
  tone,
  hero,
  description,
  icon,
  compact,
}: {
  label: string;
  value: string | number;
  tone: string;
  hero?: boolean;
  description?: string;
  icon?: string;
  compact?: boolean;
}) {
  return (
    <article className={`metric ${tone} ${hero ? "hero" : ""} ${compact ? "compact" : ""}`}>
      {icon && <em className="metric-icon">{icon}</em>}
      <div className="metric-copy"><span>{label}</span><strong>{value}</strong>{description && <small>{description}</small>}</div>
      <i></i>
    </article>
  );
}
function Queue({ tickets, shared = false, onAttend, attendingTicketId = null, attendanceBlocked = false }: {
  tickets: Ticket[];
  shared?: boolean;
  onAttend?: (ticket: Ticket) => void;
  attendingTicketId?: number | null;
  attendanceBlocked?: boolean;
}) {
  return (
    <article className="panel queue">
      <div className="panel-title">
        <div>
          <span className="eyebrow">COLA DIGITAL</span>
          <h2>En espera</h2>
          {shared && <p>Cola compartida de la sede. Cada asesor libre llama al siguiente ticket.</p>}
        </div>
        <b>{tickets.filter((t) => t.status === "WAITING").length}</b>
      </div>
      <div className="ticket-list">
        {tickets
          .filter((t) => t.status === "WAITING")
          .map((t) => (
            <div className={`ticket${onAttend ? " ticket-with-attend" : ""}`} key={t.id}>
              <strong>{t.code}</strong>
              <div>
                <b>{t.clientName}</b>
                {t.isPreferential && <span className="preferential-badge">Preferencial</span>}
                <span>
                  {t.service.name} · <ElapsedClock since={t.arrivedAt} /> esperando
                </span>
              </div>
              {onAttend && <button
                type="button"
                className="queue-attend-button"
                onClick={() => onAttend(t)}
                disabled={attendanceBlocked || attendingTicketId !== null}
                aria-label={`Atender ticket ${t.code}`}
              >
                {attendingTicketId === t.id ? "Asignando…" : "Atender"}
              </button>}
            </div>
          ))}
        {!tickets.some((t) => t.status === "WAITING") && (
          <p className="empty">No hay turnos en espera.</p>
        )}
      </div>
    </article>
  );
}
function LiveTickets({ tickets, canManage = false, onTransferred }: { tickets: Ticket[]; canManage?: boolean; onTransferred?: (ticket: Ticket, advisorName: string) => Promise<void> }) {
  const nextWaitingId = tickets.find((ticket) => ticket.status === "WAITING")?.id;
  const splitAt = Math.ceil(tickets.length / 2);
  const columns = [tickets.slice(0, splitAt), tickets.slice(splitAt)];
  return (
    <article className="panel leader-live-tickets">
      <div className="section-heading">
        <div><span className="eyebrow">SEGUIMIENTO EN VIVO</span><h2>Tickets y módulos</h2><p>Tickets activos de tu sede y el módulo que los está atendiendo. La pausa no oculta esta vista.</p></div>
        <span className="summary-pill">{tickets.length} activo(s)</span>
      </div>
      {tickets.length ? <div className="leader-ticket-grid">{columns.map((column, index) => <div className="leader-ticket-column" key={index}>{column.map((ticket) => <LiveTicketRow key={ticket.id} ticket={ticket} canManage={canManage} onTransferred={onTransferred} isNext={ticket.id === nextWaitingId} />)}</div>)}</div> : <p className="empty">No hay tickets activos en la sede.</p>}
    </article>
  );
}
function LiveTicketRow({ ticket, canManage, onTransferred, isNext = false }: { ticket: Ticket; canManage: boolean; onTransferred?: (ticket: Ticket, advisorName: string) => Promise<void>; isNext?: boolean }) {
  const [advisors, setAdvisors] = useState<TransferAdvisor[]>([]);
  const [largeRoom, setLargeRoom] = useState<{ branchName: string; advisorName: string } | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  async function refreshAdvisors() {
    setError("");
    try {
      const response = await appFetch(`/api/tickets/${ticket.id}/transfer`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (response.ok) { setAdvisors(json.advisors || []); setLargeRoom(json.largeRoom || null); }
      else setError(json.error || "No se pudo cargar el equipo disponible.");
    } catch { setError("No se pudo conectar con el equipo disponible."); }
  }
  async function transfer() {
    if (!recipientId || busy) return;
    setBusy(true); setError("");
    try {
      const response = await appFetch(`/api/tickets/${ticket.id}/transfer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipientId: recipientId === "LARGE_ROOM" ? recipientId : Number(recipientId) }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) { setError(json.error || "No se pudo transferir el ticket."); await refreshAdvisors(); return; }
      setExpanded(false);
      setRecipientId("");
      await onTransferred?.(ticket, json.largeRoom ? `Sala grande · ${json.largeRoom.branchName} · ${json.largeRoom.advisorName}` : `${json.advisor.name} · Módulo ${json.advisor.moduleNumber}`);
    } catch { setError("No se pudo conectar para transferir el ticket."); }
    finally { setBusy(false); }
  }

  return <div className={`leader-ticket${isNext ? " is-next-ticket" : ""}`}>
    <div><strong>{ticket.code}{isNext && <span className="next-ticket-badge">Siguiente</span>}{ticket.branch?.name && <span className="live-ticket-branch">{ticket.branch.name}</span>}</strong><span>{ticket.clientName}</span></div>
    <div><b>{ticket.service.name}</b>{ticket.isPreferential && <small>Preferencial</small>}<small className="live-ticket-timing"><span>Espera en cola: <b><ElapsedClock since={ticket.arrivedAt} until={ticket.startedAt} /></b></span>{ticket.startedAt && <span>Tiempo atendiendo: <b><ElapsedClock since={ticket.startedAt} /></b></span>}</small></div>
    <div className="leader-ticket-state">
      <StatusBadge status={ticket.status} />
      <div className="leader-ticket-module"><small>{ticket.largeRoomId ? `Sala · ${ticket.assignedTo?.name || "Asesor"}` : ticket.assignedTo ? `${ticket.assignedTo.moduleNumber ? `Módulo ${ticket.assignedTo.moduleNumber} · ` : ""}${ticket.assignedTo.name}` : "Sin módulo"}</small>{canManage && <button type="button" className="ghost small derive-button" onClick={() => { setExpanded((value) => !value); if (!expanded) void refreshAdvisors(); }}>{expanded ? "Cerrar" : "Derivar"}</button>}</div>
    </div>
    {expanded && <div className="leader-ticket-transfer-row">
      <div className="manager-transfer-controls">
        <select id={`transfer-${ticket.id}`} value={recipientId} onFocus={refreshAdvisors} onChange={(event) => setRecipientId(event.target.value)} disabled={busy} aria-label={`Módulo libre para ${ticket.code}`}>
          <option value="">{advisors.length || largeRoom ? "Selecciona destino…" : "No hay asesores o salas activos"}</option>
          {advisors.map((advisor) => <option key={advisor.id} value={advisor.id}>Módulo {advisor.moduleNumber} · {advisor.name}{advisor.activeCount > 0 ? " · ya atiende " + advisor.activeCount : ""}</option>)}
          {largeRoom && <option value="LARGE_ROOM">Sala grande · {largeRoom.advisorName}</option>}
        </select>
        <button type="button" className="ghost small" onClick={transfer} disabled={!recipientId || busy}>{busy ? "Derivando…" : "Confirmar derivación"}</button>
      </div>
      {error && <small role="alert" className="transfer-error">{error}</small>}
    </div>}
  </div>;
}
function TicketTransfer({ ticketId, ticketCode, onTransferred }: { ticketId: number; ticketCode: string; onTransferred: (advisorName: string) => Promise<void> }) {
  const [advisors, setAdvisors] = useState<TransferAdvisor[]>([]);
  const [largeRoom, setLargeRoom] = useState<{ branchName: string; advisorName: string } | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  async function loadAdvisors() {
    setError("");
    try {
      const response = await appFetch(`/api/tickets/${ticketId}/transfer`, { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (response.ok) { setAdvisors(json.advisors || []); setLargeRoom(json.largeRoom || null); }
      else setError(json.error || "No se pudo cargar el equipo disponible.");
    } catch { setError("No se pudo conectar con el equipo disponible."); }
  }
  async function transfer() {
    if (!recipientId || busy) return;
    setBusy(true); setError("");
    try {
      const response = await appFetch(`/api/tickets/${ticketId}/transfer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipientId: recipientId === "LARGE_ROOM" ? recipientId : Number(recipientId) }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) { setError(json.error || "No se pudo transferir el ticket."); return; }
      await onTransferred(json.largeRoom ? `Sala grande · ${json.largeRoom.branchName} · ${json.largeRoom.advisorName}` : json.advisor.name);
    } catch { setError("No se pudo conectar para transferir el ticket."); }
    finally { setBusy(false); }
  }
  return <div className={`ticket-transfer${expanded ? " is-open" : ""}`}>
    <button type="button" className="ghost small ticket-transfer-toggle" aria-expanded={expanded} onClick={() => { const next = !expanded; setExpanded(next); if (next) void loadAdvisors(); }}>{expanded ? "Cerrar transferencia" : "Transferir"}</button>
    {expanded && <div className="ticket-transfer-panel">
      <label htmlFor={`transfer-${ticketId}`}>Transferir {ticketCode}</label>
      <div className="ticket-transfer-controls">
        <select id={`transfer-${ticketId}`} value={recipientId} onChange={(event) => setRecipientId(event.target.value)} disabled={busy || (!advisors.length && !largeRoom)}>
          <option value="">{advisors.length || largeRoom ? "Selecciona un destino disponible" : "No hay asesores ni salas disponibles en la sede"}</option>
          {advisors.map((advisor) => <option key={advisor.id} value={advisor.id}>Módulo {advisor.moduleNumber} · {advisor.name}{advisor.activeCount > 0 ? " · ya atiende " + advisor.activeCount : ""}</option>)}
          {largeRoom && <option value="LARGE_ROOM">Sala grande · {largeRoom.advisorName}</option>}
        </select>
        <button type="button" className="ghost small" onClick={transfer} disabled={!recipientId || busy}>{busy ? "Transfiriendo…" : "Transferir"}</button>
      </div>
      {error && <small role="alert" className="transfer-error">{error}</small>}
    </div>}
  </div>;
}
function durationLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours ? `${hours} h ${minutes} min` : `${minutes} min ${String(remaining).padStart(2, "0")} s`;
}

function ticketAttentionTime(ticket: Data["workerHistory"][number]) {
  const events = [...ticket.history].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  let activeSince: number | null = null;
  let total = 0;
  for (const event of events) {
    const at = new Date(event.at).getTime();
    if (event.status === "IN_SERVICE" && activeSince === null) activeSince = at;
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(event.status) && activeSince !== null) {
      total += Math.max(0, at - activeSince);
      activeSince = null;
    }
  }
  if (activeSince !== null) total += Math.max(0, new Date(ticket.completedAt || Date.now()).getTime() - activeSince);
  if (!total && ticket.startedAt && ticket.completedAt) total = Math.max(0, new Date(ticket.completedAt).getTime() - new Date(ticket.startedAt).getTime());
  return total;
}

const historyStatusLabels: Record<string, string> = {
  WAITING: "Ingresó a cola",
  CALLED: "Llamado a módulo",
  IN_SERVICE: "En atención",
  COMPLETED: "Atención finalizada",
  FAILED: "Fallido · El cliente no se acercó al llamado",
  CANCELLED: "Cancelado · El cliente se retiró durante la atención",
};

function limaDateKey(value: Date | string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function WorkerHistory({ tickets, banks, onChanged, managerMode = false, initialSelectedId = null, onClose }: {
  tickets: Data["workerHistory"] | any[];
  banks: Data["banks"];
  onChanged: (text: string) => Promise<void>;
  managerMode?: boolean;
  initialSelectedId?: number | null;
  onClose?: () => void;
}) {
  const todayKey = limaDateKey(new Date());
  const [selectedId, setSelectedId] = useState<number | null>(initialSelectedId);
  const [drafts, setDrafts] = useState<OperationDraft[]>([]);
  const [editingOperationId, setEditingOperationId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<OperationDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState(todayKey);
  const [dateTo, setDateTo] = useState(todayKey);
  const [appliedRange, setAppliedRange] = useState({ from: todayKey, to: todayKey });
  const [historyTickets, setHistoryTickets] = useState(() => tickets.filter((ticket) => limaDateKey(ticket.completedAt || ticket.createdAt) === todayKey));
  const [filtering, setFiltering] = useState(false);
  const selected = historyTickets.find((ticket) => ticket.id === selectedId) || tickets.find((ticket) => ticket.id === selectedId) || null;
  const closeDetails = () => managerMode ? onClose?.() : setSelectedId(null);
  useEffect(() => {
    if (appliedRange.from === todayKey && appliedRange.to === todayKey) {
      setHistoryTickets(tickets.filter((ticket) => limaDateKey(ticket.completedAt || ticket.createdAt) === todayKey));
    }
  }, [tickets, appliedRange, todayKey]);
  useEffect(() => {
    if (selectedId === null) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeDetails(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedId, managerMode, onClose]);
  const allowedBanks = (serviceName: OperationDraft["serviceName"]) => banks.filter((bank) =>
    serviceName === "Efectivización"
      ? ["BCP", "BBVA", "BanBif", "Scotiabank", "Interbank", "CMR", "IO", "Tarjeta Comercial"].includes(bank.name)
      : ["BCP", "BBVA", "BanBif", "Scotiabank", "Interbank"].includes(bank.name),
  );
  function addDraft(serviceName: OperationDraft["serviceName"] = "Efectivización") {
    const bank = allowedBanks(serviceName)[0];
    setDrafts((rows) => [...rows, {
      serviceName,
      bankId: bank?.id || null,
      amount: "",
      commissionPlan: bank?.name === "Interbank" ? "INTERBANK_1_5" : "ATK_1",
      settlementTiming: "NEXT_BUSINESS_DAY",
      debtRate: "1",
      commercialChannel: null,
    }]);
    setError("");
  }
  function updateDraft(index: number, update: Partial<OperationDraft>) {
    setDrafts((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...update } : row));
  }
  function editOperation(operation: any) {
    const serviceName: OperationDraft["serviceName"] = operation.service.name === "Pago de deuda" ? "Pago de deuda" : "Efectivización";
    const bankName = operation.bank?.name || "";
    const rate = Number(operation.rate);
    const commissionPlan: OperationDraft["commissionPlan"] = bankName === "Interbank"
      ? rate === 2 ? "INTERBANK_2" : "INTERBANK_1_5"
      : rate === 0.35 ? "ATK_0_35" : rate === 0.5 ? "ATK_0_5" : "ATK_1";
    setEditingOperationId(operation.id);
    setEditDraft({
      serviceName,
      bankId: operation.bank?.id || null,
      amount: (Number(operation.amount) + Number(operation.profit)).toFixed(2),
      commissionPlan,
      settlementTiming: ["BanBif", "Scotiabank"].includes(bankName) && rate === 1.5 ? "SAME_DAY" : "NEXT_BUSINESS_DAY",
      debtRate: String(rate || 1),
      commercialChannel: operation.commercialChannel === "PAYMENT_LINK" ? "PAYMENT_LINK" : operation.commercialChannel === "POS" ? "POS" : null,
    });
    setError("");
  }
  function stopEditingOperation() {
    setEditingOperationId(null);
    setEditDraft(null);
    setError("");
  }
  async function saveEditedOperation() {
    if (!selected || !editDraft || editingOperationId === null || busy) return;
    const amount = Number(editDraft.amount);
    if (!editDraft.bankId || !Number.isFinite(amount) || amount <= 0) {
      setError("Completa el banco y un monto válido para guardar los cambios.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await appFetch(`/api/tickets/${selected.id}/operations/${editingOperationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editDraft, amount, debtRate: Number(editDraft.debtRate) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.error || "No se pudo actualizar la operación."); return; }
      stopEditingOperation();
      await onChanged(`Operación de ${selected.code} actualizada; sus totales e indicadores ya reflejan el cambio.`);
      if (managerMode) setSelectedId(null);
      else await loadHistoryRange(appliedRange.from, appliedRange.to);
    } catch {
      setError("No se pudo conectar para actualizar la operación.");
    } finally {
      setBusy(false);
    }
  }
  async function loadHistoryRange(from: string, to: string) {
    const response = await appFetch(`/api/worker/history?${new URLSearchParams({ from, to })}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "No se pudo cargar el historial.");
    setHistoryTickets(result.tickets || []);
  }
  async function applyHistoryRange() {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      setError("La fecha inicial debe ser igual o anterior a la fecha final.");
      return;
    }
    setFiltering(true);
    setError("");
    try {
      await loadHistoryRange(dateFrom, dateTo);
      setAppliedRange({ from: dateFrom, to: dateTo });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el historial.");
    } finally {
      setFiltering(false);
    }
  }
  async function saveOperations() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const operations = drafts.map((draft) => ({
        ...draft,
        amount: Number(draft.amount),
        debtRate: Number(draft.debtRate),
      }));
      if (!operations.length || operations.some((operation) => !operation.bankId || !Number.isFinite(operation.amount) || operation.amount <= 0)) {
        setError("Completa el banco y un monto válido en cada operación.");
        return;
      }
      const response = await appFetch(`/api/tickets/${selected.id}/operations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operations }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.error || "No se pudieron guardar las operaciones."); return; }
      setDrafts([]);
      await onChanged(`${result.operations.length} operación(es) agregada(s) a ${selected.code}.`);
      if (managerMode) setSelectedId(null);
      else await loadHistoryRange(appliedRange.from, appliedRange.to);
    } catch {
      setError("No se pudo conectar para guardar las operaciones.");
    } finally {
      setBusy(false);
    }
  }
  async function reactivate() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await appFetch(`/api/tickets/${selected.id}/reactivate`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.error || "No se pudo reactivar el ticket."); return; }
      const code = selected.code;
      setSelectedId(null);
      setDrafts([]);
      await onChanged(`${code} volvió a atención. El nuevo tiempo de atención ya está corriendo.`);
      if (managerMode) setSelectedId(null);
      else await loadHistoryRange(appliedRange.from, appliedRange.to);
    } catch {
      setError("No se pudo conectar para reactivar el ticket.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`panel worker-history${managerMode ? " manager-ticket-detail" : ""}`}>
      <div className="panel-title">
        <div className="worker-history-title">
          <NavIcon name="chart" />
          <div><span className="eyebrow">MI HISTORIAL</span><h2>Atenciones realizadas</h2></div>
        </div>
        <b>{historyTickets.length}</b>
      </div>
      <div className="worker-history-controls-row">
        <p className="operation-note">Selecciona un ticket para revisar sus tiempos, movimientos y operaciones.</p>
        <div className="history-date-filters" aria-label="Filtrar atenciones por fechas">
        <label>Desde<input type="date" value={dateFrom} max={todayKey} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>Hasta<input type="date" value={dateTo} max={todayKey} onChange={(event) => setDateTo(event.target.value)} /></label>
        <button type="button" onClick={() => void applyHistoryRange()} disabled={filtering}>{filtering ? "Buscando…" : "Filtrar"}</button>
        </div>
      </div>
      {error && !selected && <p className="history-filter-error" role="alert">{error}</p>}
      <div className="history-list">
        {historyTickets.map((ticket: any) => {
          const totalAmount = ticket.operations.reduce((sum: number, operation: any) => sum + Number(operation.amount), 0);
          const totalProfit = ticket.operations.reduce((sum: number, operation: any) => sum + Number(operation.profit), 0);
          return (
            <div className="history-ticket history-ticket-button" key={ticket.id} role="button" tabIndex={0} onClick={() => { setSelectedId(ticket.id); setDrafts([]); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedId(ticket.id); setDrafts([]); setError(""); } }} aria-label={`Ver información del ticket ${ticket.code}`}>
              <div><strong>{ticket.code}</strong><span>{ticket.clientName}</span></div>
              <div><b>{ticket.service.name}</b><small>{ticket.completedAt ? new Date(ticket.completedAt).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }) : "Sin hora final"}</small></div>
              <div><StatusBadge status={ticket.status} /><small>{ticket.operations.length ? `${ticket.operations.length} operación(es) · Vol. ${money(totalAmount)} · Util. ${money(totalProfit)}` : "Sin operaciones registradas"}</small><span className="history-open-hint">Ver detalle →</span></div>
            </div>
          );
        })}
        {!historyTickets.length && <p className="empty">No hay atenciones finalizadas, fallidas ni canceladas en este rango de fechas.</p>}
      </div>
      {selected && <div className="dialog-backdrop history-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetails(); }}>
        <section className="dialog ticket-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="history-detail-title">
          <header className="ticket-detail-header">
            <div><span className="eyebrow">DETALLE DEL TICKET</span><h2 id="history-detail-title">{selected.code}</h2><p>{selected.clientName} · {selected.service.name}<br /><span className="ticket-detail-dni">DNI: {selected.dni || "No registrado"}</span></p></div>
            <div className="ticket-detail-heading-actions">
              {(["COMPLETED", "FAILED", "CANCELLED"] as string[]).includes(selected.status) && <button type="button" className="ticket-reactivate-primary" onClick={() => void reactivate()} disabled={busy}>{busy ? "Reactivando…" : "↻ Reactivar ticket"}</button>}
              <StatusBadge status={selected.status} />
              <button type="button" className="ghost small" onClick={closeDetails}>Cerrar</button>
            </div>
          </header>

          {(() => {
            const events = [...selected.history].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
            const firstCalled = events.find((event) => event.status === "CALLED" || event.status === "IN_SERVICE");
            const waitMilliseconds = firstCalled ? new Date(firstCalled.at).getTime() - new Date(selected.arrivedAt).getTime() : 0;
            const attentionMilliseconds = ticketAttentionTime(selected);
            const totalNet = selected.operations.reduce((sum: number, operation: any) => sum + Number(operation.amount), 0);
            const totalProfit = selected.operations.reduce((sum: number, operation: any) => sum + Number(operation.profit), 0);
            const operationServiceNames = new Set(["Efectivización", "Pago de deuda"]);
            return <>
              <div className="ticket-detail-metrics">
                <div><span className="ticket-detail-metric-icon" aria-hidden="true">▦</span><span>Ingreso</span><b>{new Date(selected.arrivedAt).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" })}</b></div>
                <div><span className="ticket-detail-metric-icon" aria-hidden="true">◷</span><span>Espera hasta el primer llamado</span><b>{durationLabel(waitMilliseconds)}</b></div>
                <div><span className="ticket-detail-metric-icon" aria-hidden="true">◴</span><span>Atención acumulada</span><b>{durationLabel(attentionMilliseconds)}</b></div>
                <div><span className="ticket-detail-metric-icon" aria-hidden="true">⚙</span><span>Operaciones</span><b>{selected.operations.length}</b></div>
              </div>

              <section className="ticket-detail-section">
                <h3>Movimientos del ticket</h3>
                {events.length ? <ol className="ticket-history-timeline">{events.map((event, index) => {
                  const hasEarlierEnd = events.slice(0, index).some((item) => ["COMPLETED", "FAILED", "CANCELLED"].includes(item.status));
                  const label = event.status === "IN_SERVICE" && hasEarlierEnd ? "Ticket reactivado · En atención" : historyStatusLabels[event.status] || event.status;
                  return <li key={event.id}><span className="timeline-dot" aria-hidden="true">✓</span><div><b>{label}</b><small>{new Date(event.at).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" })}{event.actor?.name ? ` · ${event.actor.name}` : ""}</small></div></li>;
                })}</ol> : <p className="operation-note">No hay movimientos históricos registrados para este ticket.</p>}
              </section>

              <section className="ticket-detail-section">
                <div className="ticket-detail-section-heading"><h3>Operaciones registradas</h3>{selected.operations.length > 0 && <span>{selected.operations.length} · Neto {money(totalNet)} · Comisión/utilidad {money(totalProfit)}</span>}</div>
                {selected.operations.length ? <div className="ticket-operation-list">{selected.operations.map((operation: any) => {
                  const hasNetAmount = operationServiceNames.has(operation.service.name);
                  const gross = Number(operation.amount) + Number(operation.profit);
                  if (editingOperationId === operation.id && editDraft) {
                    const editBanks = allowedBanks(editDraft.serviceName);
                    const editBank = editBanks.find((candidate) => candidate.id === editDraft.bankId);
                    const editAmount = Number(editDraft.amount);
                    let editCommission = 0;
                    if (editAmount > 0 && editBank) {
                      if (editDraft.serviceName === "Efectivización") {
                        try { editCommission = effectivizacionCommission(editBank.name, editAmount, editDraft.commissionPlan, editDraft.settlementTiming).profit; } catch { editCommission = 0; }
                      } else editCommission = debtCommission(editAmount, Number(editDraft.debtRate));
                    }
                    return <article className="ticket-operation-item ticket-operation-edit" key={operation.id}>
                      <div className="ticket-operation-edit-fields">
                        <select aria-label="Tipo de operación" value={editDraft.serviceName} onChange={(event) => {
                          const serviceName = event.target.value as OperationDraft["serviceName"];
                          const firstBank = allowedBanks(serviceName)[0];
                          setEditDraft({ ...editDraft, serviceName, bankId: firstBank?.id || null, commercialChannel: null, commissionPlan: firstBank?.name === "Interbank" ? "INTERBANK_1_5" : "ATK_1" });
                        }}><option value="Efectivización">Efectivización</option><option value="Pago de deuda">Pago de deuda</option></select>
                        <BankSelect ariaLabel="Banco de la operación" banks={editBanks} value={editDraft.bankId} placeholder="Selecciona banco" onChange={(bankId) => {
                          const nextBank = editBanks.find((candidate) => candidate.id === bankId);
                          setEditDraft({ ...editDraft, bankId, commercialChannel: nextBank?.name === "Tarjeta Comercial" ? editDraft.commercialChannel || "POS" : null, commissionPlan: nextBank?.name === "Interbank" ? "INTERBANK_1_5" : editDraft.commissionPlan.startsWith("INTERBANK_") ? "ATK_1" : editDraft.commissionPlan });
                        }} />
                        {editDraft.serviceName === "Efectivización" && editBank?.name === "Tarjeta Comercial" && <select aria-label="Canal de Tarjeta Comercial" value={editDraft.commercialChannel || "POS"} onChange={(event) => setEditDraft({ ...editDraft, commercialChannel: event.target.value as "POS" | "PAYMENT_LINK" })}><option value="POS">POS</option><option value="PAYMENT_LINK">Link de pago</option></select>}
                        {editDraft.serviceName === "Efectivización" && editBank?.name !== "CMR" && editBank?.name !== "IO" && editBank?.name !== "Tarjeta Comercial" && <select aria-label="Plan de comisión" value={editDraft.commissionPlan} onChange={(event) => setEditDraft({ ...editDraft, commissionPlan: event.target.value as OperationDraft["commissionPlan"] })}>{commissionPlans.filter((plan) => plan.id.startsWith("INTERBANK_") === (editBank?.name === "Interbank")).map((plan) => <option key={plan.id} value={plan.id}>{plan.label}</option>)}</select>}
                        {editDraft.serviceName === "Pago de deuda" && <select aria-label="Comisión de pago de deuda" value={editDraft.debtRate} onChange={(event) => setEditDraft({ ...editDraft, debtRate: event.target.value })}>{[1, 1.5, 2, 2.5].map((rate) => <option key={rate} value={rate}>{rate}% comisión · mín. S/ {MIN_DEBT_COMMISSION}</option>)}</select>}
                        {editDraft.serviceName === "Efectivización" && ["BanBif", "Scotiabank"].includes(editBank?.name || "") && <select aria-label="Tiempo de abono" value={editDraft.settlementTiming} onChange={(event) => setEditDraft({ ...editDraft, settlementTiming: event.target.value as OperationDraft["settlementTiming"] })}>{settlementTimings.map((timing) => <option key={timing.id} value={timing.id}>{timing.label}</option>)}</select>}
                        <label>Monto bruto S/<input type="number" min="0.01" step="0.01" value={editDraft.amount} onChange={(event) => setEditDraft({ ...editDraft, amount: event.target.value })} /></label>
                      </div>
                      {editAmount > 0 && <p className="operation-preview">Comisión/utilidad: <b>{money(editCommission)}</b> · Neto: <b>{money(Math.max(0, editAmount - editCommission))}</b></p>}
                      <div className="ticket-operation-edit-actions"><button type="button" className="ghost small" onClick={stopEditingOperation} disabled={busy}>Cancelar</button><button type="button" className="small" onClick={() => void saveEditedOperation()} disabled={busy}>{busy ? "Guardando…" : "Guardar cambios"}</button></div>
                    </article>;
                  }
                  return <article className="ticket-operation-item" key={operation.id}>
                    <div><b>{operation.service.name}</b><span><BankBrand name={operation.bank?.name || "Sin banco"} /> {operation.commercialChannel ? `· ${operation.commercialChannel === "PAYMENT_LINK" ? "Link de pago" : "POS"}` : ""} {Number(operation.rate) ? `· ${Number(operation.rate)}%` : "· Comisión fija"}</span><small>{new Date(operation.createdAt).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}</small></div>
                    <div><span>{hasNetAmount ? "Monto bruto" : "Monto"}</span><b>{money(hasNetAmount ? gross : Number(operation.amount))}</b></div>
                    {hasNetAmount && <div><span>Volumen neto</span><b>{money(Number(operation.amount))}</b></div>}
                    <div><span>Comisión / utilidad</span><b>{money(Number(operation.profit))}</b></div>
                    <button type="button" className="ghost small ticket-operation-edit-button" onClick={() => editOperation(operation)} disabled={busy}>Editar</button>
                  </article>;
                })}</div> : <p className="operation-note">Este ticket no tiene operaciones registradas.</p>}
              </section>

              {selected.notes && <section className="ticket-detail-section"><h3>Notas</h3><p className="ticket-detail-notes">{selected.notes}</p></section>}

              {selected.status === "COMPLETED" && <section className="ticket-detail-section ticket-add-operation">
                <div><h3>Agregar operación</h3><p>Se guardará en el ticket y se reflejará en los indicadores del periodo al que pertenece.</p></div>
                {drafts.map((draft, index) => {
                  const rowBanks = allowedBanks(draft.serviceName);
                  const bank = rowBanks.find((candidate) => candidate.id === draft.bankId);
                  const amount = Number(draft.amount);
                  let commission = 0;
                  if (draft.serviceName === "Efectivización" && bank && amount > 0) {
                    try { commission = effectivizacionCommission(bank.name, amount, draft.commissionPlan, draft.settlementTiming).profit; } catch { commission = 0; }
                  } else if (draft.serviceName === "Pago de deuda" && amount > 0) commission = debtCommission(amount, Number(draft.debtRate));
                  return <div className="operation-row history-operation-row" key={index}>
                    <select aria-label={`Tipo de operación nueva ${index + 1}`} value={draft.serviceName} onChange={(event) => {
                      const serviceName = event.target.value as OperationDraft["serviceName"];
                      const firstBank = allowedBanks(serviceName)[0];
                      updateDraft(index, { serviceName, bankId: firstBank?.id || null, commercialChannel: null, commissionPlan: firstBank?.name === "Interbank" ? "INTERBANK_1_5" : "ATK_1" });
                    }}><option value="Efectivización">Efectivización</option><option value="Pago de deuda">Pago de deuda</option></select>
                    <BankSelect ariaLabel={`Banco de operación nueva ${index + 1}`} banks={rowBanks} value={draft.bankId} placeholder="Selecciona banco" onChange={(bankId) => {
                      const nextBank = rowBanks.find((candidate) => candidate.id === bankId);
                      updateDraft(index, { bankId, commercialChannel: nextBank?.name === "Tarjeta Comercial" ? draft.commercialChannel : null, commissionPlan: nextBank?.name === "Interbank" ? "INTERBANK_1_5" : draft.commissionPlan.startsWith("INTERBANK_") ? "ATK_1" : draft.commissionPlan });
                    }} />
                    {draft.serviceName === "Efectivización" && bank?.name === "Tarjeta Comercial" && <select aria-label={`Canal de Tarjeta Comercial ${index + 1}`} value={draft.commercialChannel || "POS"} onChange={(event) => updateDraft(index, { commercialChannel: event.target.value as "POS" | "PAYMENT_LINK" })}><option value="POS">POS</option><option value="PAYMENT_LINK">Link de pago</option></select>}
                    {draft.serviceName === "Efectivización" && bank?.name !== "CMR" && bank?.name !== "IO" && bank?.name !== "Tarjeta Comercial" && <select aria-label="Plan de comisión" value={draft.commissionPlan} onChange={(event) => updateDraft(index, { commissionPlan: event.target.value as OperationDraft["commissionPlan"] })}>{commissionPlans.filter((plan) => plan.id.startsWith("INTERBANK_") === (bank?.name === "Interbank")).map((plan) => <option key={plan.id} value={plan.id}>{plan.label}</option>)}</select>}
                    {draft.serviceName === "Pago de deuda" && <select aria-label="Comisión de pago de deuda" value={draft.debtRate} onChange={(event) => updateDraft(index, { debtRate: event.target.value })}>{[1, 1.5, 2, 2.5].map((rate) => <option key={rate} value={rate}>{rate}% comisión · mín. S/ {MIN_DEBT_COMMISSION}</option>)}</select>}
                    {draft.serviceName === "Efectivización" && ["BanBif", "Scotiabank"].includes(bank?.name || "") && <select aria-label="Tiempo de abono" value={draft.settlementTiming} onChange={(event) => updateDraft(index, { settlementTiming: event.target.value as OperationDraft["settlementTiming"] })}>{settlementTimings.map((timing) => <option key={timing.id} value={timing.id}>{timing.label}</option>)}</select>}
                    <input type="number" min="0.01" step="0.01" placeholder="Monto S/" aria-label="Monto de la operación" value={draft.amount} onChange={(event) => updateDraft(index, { amount: event.target.value })} />
                    <button type="button" className="danger small" onClick={() => setDrafts((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>Quitar</button>
                    {amount > 0 && <p className="operation-preview">Comisión: <b>{money(commission)}</b> · Neto: <b>{money(Math.max(0, amount - commission))}</b></p>}
                  </div>;
                })}
                <div className="current-actions ticket-detail-actions">
                  <button type="button" className="ticket-add-effect" onClick={() => addDraft("Efectivización")}>＋ Efectivización</button>
                  <button type="button" className="ticket-add-debt" onClick={() => addDraft("Pago de deuda")}>＋ Pago de deuda</button>
                  {drafts.length > 0 && <button type="button" onClick={() => void saveOperations()} disabled={busy}>{busy ? "Guardando…" : `Guardar ${drafts.length} operación(es)`}</button>}
                </div>
                {error && <p className="ticket-detail-error" role="alert">{error}</p>}
              </section>}

              {selected.status === "FAILED" && <p className="operation-note">Para registrar una operación en un ticket fallido, reactívalo y finalízalo como exitoso.</p>}
            </>;
          })()}
        </section>
      </div>}
    </article>
  );
}

function Leadership({
  data,
  tickets,
  selected,
  onSelect,
  period,
  onPeriod,
  rangeFrom,
  rangeTo,
  onRange,
  onTicketTransferred,
}: {
  data: Data;
  tickets: Ticket[];
  selected: string;
  onSelect: (value: string) => void;
  period: "today" | "week" | "month";
  onPeriod: (value: "today" | "week" | "month") => void;
  rangeFrom: string;
  rangeTo: string;
  onRange: (from: string, to: string) => void;
  onTicketTransferred: (ticket: Ticket, advisorName: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<"summary" | "indicators" | "frequent" | "team" | "rates" | "analysis" | "room">(
      "summary",
    ),
    [indicatorView, setIndicatorView] = useState<"attention" | "banking" | "incomplete" | "demand" | "team" | "branches" | "districts">("attention"),
    [admin, setAdmin] = useState<any>(null),
    [analysis, setAnalysis] = useState<any[]>([]),
    [analysisLoading, setAnalysisLoading] = useState(false),
    [selectedAnalysisId, setSelectedAnalysisId] = useState<number | null>(null),
    [analysisQuery, setAnalysisQuery] = useState(""),
    [info, setInfo] = useState("");
  const [infoClosing, setInfoClosing] = useState(false);
  const [branchComparison, setBranchComparison] = useState<BranchComparisonData | null>(null);
  const [branchComparisonLoading, setBranchComparisonLoading] = useState(false);
  const [branchComparisonError, setBranchComparisonError] = useState("");
  const [districtOrigins, setDistrictOrigins] = useState<DistrictOriginsData | null>(null);
  const [districtOriginsLoading, setDistrictOriginsLoading] = useState(false);
  const [districtOriginsError, setDistrictOriginsError] = useState("");
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const adminBranchName = data.branches.find((branch) => branch.id === data.selectedBranchId)?.name;
  const branchScopeName = data.user.role === "ADMIN" ? adminBranchName || "todas las sedes" : data.user.branchName || "tu sede";
  const [analysisFrom, setAnalysisFrom] = useState("");
  const [analysisTo, setAnalysisTo] = useState("");
  const [analysisStatus, setAnalysisStatus] = useState("HISTORY");
  const [analysisBranchId, setAnalysisBranchId] = useState("");
  const selectedEnd = rangeTo || rangeFrom;
  const isHistoricalRange = Boolean(selectedEnd && selectedEnd < todayKey);
  const isSingleDayRange = Boolean(rangeFrom && selectedEnd === rangeFrom);
  useEffect(() => {
    if (tab !== "indicators" || indicatorView !== "branches" || data.user.role !== "ADMIN") return;
    const query = new URLSearchParams();
    if (rangeFrom) query.set("from", rangeFrom);
    if (rangeTo) query.set("to", rangeTo);
    if (!rangeFrom) query.set("period", period);
    const controller = new AbortController();
    setBranchComparisonLoading(true);
    setBranchComparisonError("");
    void appFetch(`/api/indicators/branches?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "No se pudo cargar la comparación de sedes.");
        setBranchComparison(result);
      })
      .catch((error) => { if (error.name !== "AbortError") setBranchComparisonError(error.message || "No se pudo cargar la comparación de sedes."); })
      .finally(() => { if (!controller.signal.aborted) setBranchComparisonLoading(false); });
    return () => controller.abort();
  }, [tab, indicatorView, data.user.role, rangeFrom, rangeTo, period]);
  useEffect(() => {
    if (tab !== "indicators" || indicatorView !== "districts" || data.user.role !== "ADMIN") return;
    const query = new URLSearchParams();
    if (rangeFrom) query.set("from", rangeFrom);
    if (rangeTo) query.set("to", rangeTo);
    if (!rangeFrom) query.set("period", period);
    const controller = new AbortController();
    setDistrictOriginsLoading(true);
    setDistrictOriginsError("");
    void appFetch(`/api/indicators/districts?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "No se pudo cargar la procedencia de los clientes.");
        setDistrictOrigins(result);
      })
      .catch((error) => { if (error.name !== "AbortError") setDistrictOriginsError(error.message || "No se pudo cargar la procedencia de los clientes."); })
      .finally(() => { if (!controller.signal.aborted) setDistrictOriginsLoading(false); });
    return () => controller.abort();
  }, [tab, indicatorView, data.user.role, rangeFrom, rangeTo, period]);
  useEffect(() => {
    if (!info) return;
    setInfoClosing(false);
    const closeAnimation = window.setTimeout(() => setInfoClosing(true), 4_600);
    const dismiss = window.setTimeout(() => setInfo(""), 4_850);
    return () => {
      window.clearTimeout(closeAnimation);
      window.clearTimeout(dismiss);
    };
  }, [info]);
  useEffect(() => {
    if (["summary", "indicators", "frequent", "team", "rates", "analysis", "room"].includes(selected))
      setTab(selected as "summary" | "indicators" | "frequent" | "team" | "rates" | "analysis" | "room");
  }, [selected]);
  useEffect(() => {
    if (tab !== "analysis") setSelectedAnalysisId(null);
  }, [tab]);
  useEffect(() => {
    if (tab !== "analysis") return;
    const todayQuery = new URLSearchParams({ from: todayKey, to: todayKey, status: "HISTORY" });
    if (data.selectedBranchId) todayQuery.set("branchId", String(data.selectedBranchId));
    const query = todayQuery.toString();
    setAnalysisFrom(todayKey);
    setAnalysisTo(todayKey);
    setAnalysisStatus("HISTORY");
    setAnalysisBranchId(data.selectedBranchId ? String(data.selectedBranchId) : "");
    setAnalysisQuery(query);
    const controller = new AbortController();
    setAnalysisLoading(true);
    void appFetch(`/api/analysis?${query}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (response.ok) setAnalysis((await response.json()).tickets || []);
      else throw new Error("No se pudieron cargar las atenciones.");
    }).catch((error) => { if (error.name !== "AbortError") setInfo(error.message || "No se pudieron cargar las atenciones."); })
      .finally(() => { if (!controller.signal.aborted) setAnalysisLoading(false); });
    return () => controller.abort();
  }, [tab, todayKey, data.selectedBranchId]);
  const choose = (value: "summary" | "indicators" | "frequent" | "team" | "rates" | "analysis" | "room") => {
    setTab(value);
    onSelect(value);
  };
  const load = useCallback(async () => {
    const r = await appFetch("/api/admin");
    if (r.ok) setAdmin(await r.json());
  }, []);
  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);
  async function saveServices(userId: number, ids: number[], moduleNumber: number | null, dni: string | null, available: boolean) {
    const payload: Record<string, unknown> = { action: "workerServices", userId, serviceIds: ids, moduleNumber, dni, available };
    let r = await appFetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    let result = await r.json().catch(() => ({}));
    if (r.status === 409 && result.moduleConflict) {
      const conflict = result.moduleConflict as { id: number; name: string; moduleNumber: number };
      const confirmed = window.confirm(`El módulo ${conflict.moduleNumber} está ocupado por ${conflict.name}. ¿Quieres intercambiar los módulos? Los tickets activos seguirán asignados a cada colaborador y aparecerán en su módulo nuevo. Ambos quedarán disponibles para recibir nuevos turnos.`);
      if (!confirmed) { setInfo("No se hicieron cambios de módulo."); return; }
      payload.swapWithUserId = conflict.id;
      r = await appFetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      result = await r.json().catch(() => ({}));
    }
    setInfo(r.ok ? result.swapped ? `Módulos intercambiados.${result.activeTicketPreserved ? " Los tickets activos siguen con cada colaborador." : ""} Ambos quedaron disponibles.` : result.activeTicketPreserved ? "Módulo actualizado. El ticket activo sigue con el colaborador en su nuevo módulo, y quedó disponible para nuevos turnos." : "Cambios del usuario guardados." : result.error || "No se pudieron guardar los cambios.");
    if (r.ok) { setSelectedWorkerId(null); load(); }
  }
  async function saveWorkerBranch(userId: number, branchId: number) {
    const r = await appFetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "userBranch", userId, branchId }) });
    const result = await r.json().catch(() => ({}));
    setInfo(r.ok ? `Sede actualizada a ${result.branch}.` : result.error || "No se pudo cambiar la sede.");
    if (r.ok) load();
  }
  async function deleteUser(id: number, name: string) {
    if (!window.confirm(`¿Eliminar a ${name}? Si tiene tickets previos, se desactivará para conservar el historial.`)) return;
    const r = await appFetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "deleteUser", id }) });
    const result = await r.json().catch(() => ({}));
    setInfo(r.ok ? (result.deactivated ? "Usuario desactivado: su historial se conserva." : "Usuario eliminado.") : result.error || "No se pudo eliminar el usuario.");
    if (r.ok) { setSelectedWorkerId(null); load(); }
  }
  async function syncRegistrosUsers() {
    const r = await appFetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "syncRegistrosUsers" }) });
    const result = await r.json().catch(() => ({}));
    const conflicts = Array.isArray(result.conflicts) ? result.conflicts as string[] : [];
    const summary = `${result.count || 0} usuario(s) sincronizado(s) desde Registros ATK.`;
    setInfo(r.ok ? `${summary}${conflicts.length ? ` Conflicto para: ${conflicts.join(", ")}.` : ""}` : result.error || "No se pudo sincronizar los usuarios.");
    if (r.ok) load();
  }
  async function setUserAvailability(userId: number, available: boolean) {
    const r = await appFetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setAvailability", userId, available }) });
    const result = await r.json().catch(() => ({}));
    setInfo(r.ok ? (available ? "Atención activada." : "Atención desactivada.") : result.error || "No se pudo cambiar el estado.");
    if (r.ok) load();
  }
  async function saveRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const r = await appFetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "rate",
        serviceId: Number(f.get("serviceId")),
        bankId: Number(f.get("bankId")),
        rate: Number(f.get("rate")),
      }),
    });
    setInfo(r.ok ? "Tasa guardada." : (await r.json()).error);
    if (r.ok) load();
  }
  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(event.currentTarget);
    const r = await appFetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "user",
        name: f.get("name"),
        username: f.get("username"),
        dni: f.get("dni"),
        role: f.get("role"),
        branchId: Number(f.get("branchId")) || null,
        active: true,
        password: f.get("password") || undefined,
      }),
    });
    const j = await r.json();
    setInfo(r.ok ? "Usuario creado correctamente." : j.error);
    if (r.ok) {
      form.reset();
      load();
    }
  }
  async function searchAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const q = new URLSearchParams();
    ["serviceId", "workerId", "branchId"].forEach(
      (k) => {
        const v = String(f.get(k) || "");
        if (v) q.set(k, v);
      },
    );
    const from = String(f.get("from") || "");
    const to = String(f.get("to") || "");
    const status = String(f.get("status") || "");
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    if (status) q.set("status", status);
    setAnalysisQuery(q.toString());
    setAnalysisLoading(true);
    try {
      const r = await appFetch(`/api/analysis?${q}`, { cache: "no-store" });
      if (!r.ok) throw new Error("No se pudieron cargar las atenciones.");
      setAnalysis((await r.json()).tickets || []);
    } catch (error) {
      setInfo(error instanceof Error ? error.message : "No se pudieron cargar las atenciones.");
    } finally {
      setAnalysisLoading(false);
    }
  }
  async function reloadAnalysis() {
    const r = await appFetch(`/api/analysis?${analysisQuery}`, { cache: "no-store" });
    if (r.ok) setAnalysis((await r.json()).tickets);
  }
  const workers = (admin?.users || []).filter((worker: any) => !data.selectedBranchId || worker.branchId === data.selectedBranchId);
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  useEffect(() => {
    if (selectedWorkerId === null) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedWorkerId(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedWorkerId]);
  const [workerSearch, setWorkerSearch] = useState("");
  const selectedWorker = workers.find((worker: any) => worker.id === selectedWorkerId) || null;
  const visibleWorkers = workers.filter((worker: any) => worker.name.toLowerCase().includes(workerSearch.toLowerCase()) || worker.username.toLowerCase().includes(workerSearch.toLowerCase()));
  const totalCommercialTickets = data.commercial.reduce((sum, item) => sum + item.tickets, 0);
  return (
    <section className={`leader-area${tab === "summary" ? " leader-summary-view" : ""}`}>
      <div className="tabs" aria-label="Navegación de secciones">
        <button
          className={tab === "summary" ? "active" : ""}
          onClick={() => choose("summary")}
        >
          Resumen
        </button>
        <button
          className={tab === "team" ? "active" : ""}
          onClick={() => choose("team")}
        >
          Equipo
        </button>
        <button
          className={tab === "frequent" ? "active" : ""}
          onClick={() => choose("frequent")}
        >
          Clientes frecuentes
        </button>
        <button
          className={tab === "analysis" ? "active" : ""}
          onClick={() => choose("analysis")}
        >
          Análisis
        </button>
        {data.user.role === "ADMIN" && (
          <button
            className={tab === "rates" ? "active" : ""}
            onClick={() => choose("rates")}
          >
            Tasas y ajustes
          </button>
        )}
        {data.user.role === "ADMIN" && <button className={tab === "room" ? "active" : ""} onClick={() => choose("room")}>Sala grande</button>}
      </div>
      {info && (
        <div className={`notice toast-notice${infoClosing ? " is-leaving" : ""}`} role="status" aria-live="polite">
          {info}
          <button onClick={() => setInfo("")}>×</button>
        </div>
      )}
      {tab === "summary" && (
        <>
          <section className="leader-filter panel">
            <div><span className="eyebrow">OPERACIÓN EN VIVO</span><h2>Resumen · {branchScopeName}</h2><p>Estado de la cola y de la atención en este momento.</p></div>
          </section>
          <section className="metrics secondary leader-kpis">
            <Metric label="En espera ahora" value={data.stats.waiting} description="Personas actualmente en cola" tone="orange" icon="🕘" />
            <Metric label="En atención ahora" value={data.stats.inService} description="Personas siendo atendidas" tone="cyan" icon="👤" />
            <Metric label="Atendidos" value={data.stats.completed} description="Finalizados en el periodo" tone="cyan" icon="👥" />
            <Metric label="Utilidad del periodo" value={money(data.stats.totalProfit)} description="Resultado comercial acumulado" tone="green" icon="🪙" />
          </section>
          <section className="summary-operations-grid">
            <article className="panel operational-status">
              <span className="eyebrow">ESTADO OPERATIVO</span><h2>Cómo está la sede</h2>
              <div className="status-rows">
                <div><span>Espera promedio en cola</span><b>{Math.round(data.stats.avgWait)} min</b></div>
                <div><span>Atención promedio por cliente</span><b>{Math.round(data.stats.avgAttention)} min</b></div>
                <div><span>Tickets fallidos</span><b>{data.quality.failed}</b></div>
              </div>
            </article>
            <article className="panel operational-alerts">
              <span className="eyebrow">ALERTAS Y PRIORIDADES</span><h2>Seguimiento rápido</h2>
              <div className="alert-list">
                <p className={data.stats.waiting ? "alert-warning" : "alert-ok"}>{data.stats.waiting ? `Hay ${data.stats.waiting} persona(s) esperando en cola.` : "No hay personas esperando en cola."}</p>
                <p className={data.stats.avgWait > 15 ? "alert-warning" : "alert-ok"}>{data.stats.avgWait > 15 ? "La espera promedio supera 15 minutos." : "La espera promedio está dentro de la meta."}</p>
                <p>{totalCommercialTickets} ticket(s) comercial(es) procesados en el periodo.</p>
              </div>
            </article>
          </section>
        </>
      )}
      {tab === "indicators" && (
        <>
          <section className="leader-filter panel">
            <div><span className="eyebrow">{rangeFrom ? "INDICADORES DEL PERÍODO" : period === "today" ? "INDICADORES DE HOY" : period === "week" ? "INDICADORES DE LA SEMANA" : "INDICADORES DEL MES"}</span><h2>Indicadores · {branchScopeName}</h2><p>Atención, operaciones, demanda y carga del equipo.</p></div>
            <div className="period-switch" aria-label="Periodo">
              <button className={!rangeFrom && period === "today" ? "active" : ""} onClick={() => onPeriod("today")}>Hoy</button>
              <button className={!rangeFrom && period === "week" ? "active" : ""} onClick={() => onPeriod("week")}>Semana</button>
              <button className={!rangeFrom && period === "month" ? "active" : ""} onClick={() => onPeriod("month")}>Mes</button>
            </div>
            <DateRangePicker from={rangeFrom} to={rangeTo} onChange={onRange} />
          </section>
          <div className="indicator-tabs" role="tablist" aria-label="Vistas de indicadores">
            {([ ["attention", "Atención"], ["banking", "Operaciones bancarias"], ["incomplete", "No completados"], ["demand", "Demanda por hora"], ["team", "Equipo"] ] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={indicatorView === id} className={indicatorView === id ? "active" : ""} key={id} onClick={() => setIndicatorView(id)}>{label}</button>)}
            {data.user.role === "ADMIN" && <button type="button" role="tab" aria-selected={indicatorView === "branches"} className={indicatorView === "branches" ? "active" : ""} onClick={() => setIndicatorView("branches")}>Sedes</button>}
            {data.user.role === "ADMIN" && <button type="button" role="tab" aria-selected={indicatorView === "districts"} className={indicatorView === "districts" ? "active" : ""} onClick={() => setIndicatorView("districts")}>Procedencia</button>}
          </div>

          {indicatorView === "attention" && <>
            <section className="metrics secondary leader-kpis indicator-kpis">
              <Metric label="Clientes recibidos" value={data.stats.totalTickets} description="En el período elegido" tone="cyan" icon="▦" />
              <Metric label="Atenciones completadas" value={data.stats.completed} description="Clientes atendidos con éxito" tone="green" icon="✓" />
              <Metric label="Espera promedio" value={`${Math.round(data.stats.avgWait)} min`} description="Desde llegada hasta inicio" tone="cyan" icon="⌛" />
              <Metric label="Atención promedio" value={`${Math.round(data.stats.avgAttention)} min`} description="Desde inicio hasta finalización" tone="cyan" icon="◷" />
            </section>
            <section className="analytics-grid">
              <article className="panel trend-panel"><div className="traffic-heading"><div><span className="eyebrow">FLUJO DE ATENCIÓN</span><h2>Clientes, espera y atención promedio</h2><p>Compara la llegada de clientes con el tiempo promedio de espera y atención.</p></div><span className="traffic-period">{rangeFrom ? isSingleDayRange ? "DÍA SELECCIONADO · POR HORA" : "RANGO · POR DÍA" : period === "today" ? "HOY · POR HORA" : period === "week" ? "SEMANA · POR DÍA" : "MES · POR DÍA"}</span></div><LineTrend values={data.trend} /></article>
              <article className="panel quality-panel"><span className="eyebrow">TRÁMITES</span><h2>Clientes por trámite</h2><ServiceMixChart services={data.servicesDistribution} /></article>
            </section>
            <FrequentClientsLink onOpen={() => choose("frequent")} />
          </>}

          {indicatorView === "banking" && <>
            <section className="metrics secondary leader-kpis indicator-kpis">
              <Metric label="Monto operado" value={money(data.stats.totalAmount)} description="Operaciones finalizadas" tone="cyan" icon="📄" />
              <Metric label="Utilidad" value={money(data.stats.totalProfit)} description="Comisiones registradas" tone="green" icon="🪙" />
              <Metric label="Operaciones" value={data.bankPerformance.reduce((sum, item) => sum + item.operations, 0)} description="En el período elegido" tone="cyan" icon="▤" />
            </section>
            <BankOperationTable rows={data.bankPerformance} />
          </>}

          {indicatorView === "incomplete" && <>
            <section className="metrics secondary leader-kpis indicator-kpis">
              <Metric label="No completados" value={data.quality.incomplete} description="Fallidos más cancelados" tone="orange" icon="⚠" />
              <Metric label="Fallidos" value={data.quality.failed} description="Marcados como fallidos" tone="orange" icon="×" />
              <Metric label="Cancelados" value={data.quality.cancelled} description="Cancelados en el período" tone="cyan" icon="—" />
              <Metric label="Proporción no completada" value={`${data.stats.totalTickets ? (data.quality.incomplete / data.stats.totalTickets * 100).toFixed(1) : "0.0"}%`} description="Sobre tickets recibidos" tone="cyan" icon="%" />
            </section>
            <IncompleteTicketsTable rows={data.incompleteByService} />
            <p className="indicator-note">Fallido: el cliente no se acercó al llamado. Cancelado: la atención inició y el cliente se retiró antes de terminar.</p>
          </>}

          {indicatorView === "demand" && <>
            <section className="panel trend-panel demand-panel">
              <div className="section-heading"><div><span className="eyebrow">LLEGADAS DE CLIENTES</span><h2>Demanda por hora</h2><p>Tickets recibidos en cada franja durante el período seleccionado.</p></div><span className="summary-pill">{data.stats.totalTickets} ticket(s)</span></div>
              <DemandBars values={data.hourlyDemand} />
            </section>
          </>}

          {indicatorView === "team" && <section className="panel team-performance indicator-team-panel">
            <div className="section-heading"><div><span className="eyebrow">CARGA Y RESULTADOS</span><h2>Atención por colaborador</h2><p>Volumen, utilidad, cantidad de atenciones y duración promedio en el período.</p></div><button className="ghost export-button" type="button" onClick={() => window.print()}>⇩ Exportar</button></div>
            <PerformanceTable workers={data.workerPerformance} />
          </section>}

          {indicatorView === "branches" && data.user.role === "ADMIN" && <section className="panel team-performance branch-comparison-panel">
            <div className="section-heading"><div><span className="eyebrow">COMPARACIÓN DE SEDES</span><h2>Resultados por sede</h2><p>Mismo período seleccionado para Centro/Lince, Sur/SJM y Norte/Los Olivos. La utilidad suma comisiones de operaciones registradas.</p></div></div>
            {branchComparisonLoading && <div className="branch-comparison-loading"><span className="preview-loading-spinner" aria-hidden="true" /><span>Cargando datos de las tres sedes…</span></div>}
            {branchComparisonError && <p className="ticket-detail-error" role="alert">{branchComparisonError}</p>}
            {!branchComparisonLoading && branchComparison && <BranchComparisonDashboard data={branchComparison} />}
          </section>}
          {indicatorView === "districts" && data.user.role === "ADMIN" && <section className="panel team-performance district-origin-panel">
            <div className="section-heading"><div><span className="eyebrow">PROCEDENCIA DE CLIENTES</span><h2>¿De qué distritos vienen?</h2><p>Distribución de tickets por distrito para el período y las sedes seleccionadas.</p></div></div>
            {districtOriginsLoading && <div className="branch-comparison-loading"><span className="preview-loading-spinner" aria-hidden="true" /><span>Cargando procedencia de clientes…</span></div>}
            {districtOriginsError && <p className="ticket-detail-error" role="alert">{districtOriginsError}</p>}
            {!districtOriginsLoading && districtOrigins && <DistrictOriginsDashboard data={districtOrigins} />}
          </section>}
        </>
      )}
      {tab === "frequent" && <FrequentClients onBack={() => choose("indicators")} />}
      {tab === "team" && (
        <section className="team-page">
          <article className="panel team-directory">
            <div className="section-heading"><div><span className="eyebrow">EQUIPO DE LA SEDE</span><h2>Gestión de usuarios y atención</h2><p>El administrador ve todas las cuentas. La disponibilidad y conexión se actualizan automáticamente.</p></div><div className="inline-actions"><span className="summary-pill">{workers.length} usuario(s)</span>{data.user.role === "ADMIN" && <button className="ghost small" onClick={syncRegistrosUsers}>↻ Sincronizar Registros ATK</button>}</div></div>
            <input className="worker-search" value={workerSearch} onChange={(event) => setWorkerSearch(event.target.value)} placeholder="Buscar por nombre o usuario" />
            <div className="table-wrap"><table><thead><tr><th>Usuario</th><th>Sede</th><th>Rol</th><th>Atiende</th><th>Atenciones</th><th>Utilidad</th><th>Trámites</th><th></th></tr></thead><tbody>{visibleWorkers.map((worker: any) => { const performance = data.workerPerformance.find((row) => row.id === worker.id); const canAttend = ["WORKER", "MANAGER"].includes(worker.role); const hasModule = Boolean(worker.moduleNumber); const isDisconnected = worker.connected === false; const attending = canAttend && worker.availability === "AVAILABLE" && hasModule && !isDisconnected; const statusText = !hasModule ? "Sin módulo" : worker.availability !== "AVAILABLE" ? "En pausa" : isDisconnected ? "Desconectado" : `Disponible · Módulo ${worker.moduleNumber}`; const statusClass = !hasModule ? "is-unassigned" : worker.availability !== "AVAILABLE" ? "is-paused" : isDisconnected ? "is-disconnected" : "is-available"; const roleLabel = worker.role === "MANAGER" ? "Jefa de sede" : worker.role === "WORKER" ? "Colaborador" : worker.role === "RECEPTION" ? "Recepción" : "Administrador"; return <tr key={worker.id}><td><div className="name-cell"><span className="avatar">{initials(worker.name)}</span><div><b>{worker.name}</b><small>@{worker.username}</small></div></div></td><td>{worker.branch?.name || "Sin sede"}</td><td>{roleLabel}</td><td>{canAttend ? <label className={`attendance-switch ${statusClass}`} title={!hasModule ? "Asigna un módulo antes de activar" : isDisconnected ? "Sin actividad por más de 90 segundos" : `Módulo ${worker.moduleNumber} · Presiona para cambiar el estado`}><input type="checkbox" aria-label={`${worker.name}: ${statusText}`} checked={Boolean(attending)} disabled={!hasModule || (isDisconnected && worker.availability !== "AVAILABLE")} onChange={(event) => setUserAvailability(worker.id, isDisconnected ? false : event.target.checked)} /><span aria-hidden="true" /><b>{statusText}</b></label> : <span>—</span>}</td><td>{performance?.attentions || 0}</td><td>{money(performance?.profit || 0)}</td><td>{worker.services.length}</td><td><button className="ghost small" onClick={() => setSelectedWorkerId(worker.id)}>Gestionar</button></td></tr>; })}</tbody></table></div>
          </article>
          {selectedWorker && <div className="user-manage-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedWorkerId(null); }}>
            <section className="user-manage-modal" role="dialog" aria-modal="true" aria-labelledby="user-manage-title" onMouseDown={(event) => event.stopPropagation()}>
              <div className="user-manage-modal-header">
                <div><span className="eyebrow">GESTIÓN DE USUARIO</span><h2 id="user-manage-title">{selectedWorker.name}</h2><p>@{selectedWorker.username} · {selectedWorker.branch?.name || "Sin sede"}</p></div>
                <button type="button" className="user-manage-close" aria-label="Cerrar" onClick={() => setSelectedWorkerId(null)}>×</button>
              </div>
              {["WORKER", "MANAGER"].includes(selectedWorker.role)
                ? <WorkerPermissions key={selectedWorker.id} worker={selectedWorker} services={admin.services || []} branches={admin.branches || []} isAdmin={data.user.role === "ADMIN"} onBranchChange={saveWorkerBranch} onSave={saveServices} onDelete={deleteUser} />
                : <UserAccountSummary worker={selectedWorker} />}
            </section>
          </div>}
          <form className="form-grid create-user" onSubmit={saveUser}>
            <span className="eyebrow full">AGREGAR USUARIO A {data.user.role === "MANAGER" ? "TU SEDE" : "UNA SEDE"}</span>
            <label>
              Nombre
              <input name="name" required />
            </label>
            <label>
              Usuario
              <input name="username" required />
            </label>
            <label>
              ID / DNI
              <input name="dni" inputMode="numeric" pattern="[0-9]{6,12}" required />
            </label>
            <label>
              Contraseña inicial
              <input name="password" type="password" required />
            </label>
            <label>
              Rol
              <select name="role">
                <option value="WORKER">Trabajador</option>
                <option value="RECEPTION">Recepción</option>
                {data.user.role === "ADMIN" && <option value="MANAGER">Jefe de sede</option>}
              </select>
            </label>
            {data.user.role === "ADMIN" ? <label>Sede<select name="branchId">{admin?.branches?.map((b: any) => <option value={b.id} key={b.id}>{b.name}</option>)}</select></label> : <input type="hidden" name="branchId" value={data.user.branchId || ""} />}
            <button>Crear usuario</button>
          </form>
          {false && data.user.role === "ADMIN" && (
            <form className="form-grid create-user" onSubmit={saveUser}>
              <label>
                Nombre
                <input name="name" required />
              </label>
              <label>
                Usuario
                <input name="username" required />
              </label>
              <label>
                Contraseña inicial
                <input name="password" type="password" required />
              </label>
              <label>
                Rol
                <select name="role">
                  <option value="WORKER">Trabajador</option>
                  <option value="RECEPTION">Recepción</option>
                  <option value="MANAGER">Jefe de sede</option>
                </select>
              </label>
              <label>
                Sede
            <select name="branchId" value={analysisBranchId} onChange={(event) => setAnalysisBranchId(event.target.value)}>
                  {admin?.branches?.map((b: any) => (
                    <option value={b.id} key={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <button>Crear usuario</button>
            </form>
          )}
        </section>
      )}
      {tab === "rates" && (
        <section className="grid leader">
          <article className="panel">
            <span className="eyebrow">CONFIGURAR TASA</span>
            <h2>Tasas por banco y trámite</h2>
            <form className="form-grid" onSubmit={saveRate}>
              <label>
                Trámite
                <select name="serviceId">
                  {admin?.services?.map((s: any) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Banco
                <BankSelect name="bankId" banks={admin?.banks || []} defaultValue={admin?.banks?.[0]?.id ?? null} />
              </label>
              <label>
                Tasa (%)
                <input
                  name="rate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  required
                />
              </label>
              <button>Guardar tasa</button>
            </form>
          </article>
          <article className="panel">
            <span className="eyebrow">TASAS VIGENTES</span>
            {admin?.rates?.map((r: any) => (
              <div className="bar-row" key={r.id}>
                <span className="bank-rate-label">
                  {r.service.name} · <BankBrand name={r.bank.name} />
                </span>
                <b>{r.rate}%</b>
              </div>
            ))}
          </article>
        </section>
      )}
      {tab === "room" && data.user.role === "ADMIN" && (
        <LargeRoomManagement
          branches={admin?.branches || []}
          tickets={tickets}
          rooms={admin?.largeRooms || []}
          onRefresh={load}
        />
      )}
      {tab === "analysis" && (
        <section className="panel">
          <span className="eyebrow">HISTORIAL DE ATENCIONES</span>
          <h2>Análisis detallado</h2>
          <form className="filters" onSubmit={searchAnalysis}>
            <input type="date" name="from" value={analysisFrom} onChange={(event) => setAnalysisFrom(event.target.value)} />
            <input type="date" name="to" value={analysisTo} onChange={(event) => setAnalysisTo(event.target.value)} />
            <select name="status" value={analysisStatus} onChange={(event) => setAnalysisStatus(event.target.value)}>
              <option value="HISTORY">Atenciones realizadas</option>
              <option value="">Todos los estados</option>
              <option value="COMPLETED">Finalizado</option>
              <option value="FAILED">Fallido</option>
              <option value="WAITING">En espera</option>
              <option value="CALLED">Llamando</option>
              <option value="IN_SERVICE">En atención</option>
            </select>
            <select name="serviceId">
              <option value="">Todos los trámites</option>
              {data.services.map((s) => (
                <option value={s.id} key={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {data.user.role === "ADMIN" && (
              <select name="branchId">
                <option value="">Todas las sedes</option>
                {admin?.branches?.map((b: any) => (
                  <option value={b.id} key={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <button disabled={analysisLoading}>{analysisLoading ? "Buscando…" : "Buscar"}</button>
          </form>
          <div className="analysis-results-summary">
            <p className="operation-note">Selecciona un ticket para revisar sus movimientos, tiempos y operaciones, o para reactivarlo.</p>
            <span className="analysis-results-count" aria-live="polite">
              {analysisLoading ? "Buscando…" : `${analysis.length} ${analysis.length === 1 ? "ticket" : "tickets"}`}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Cliente</th>
                  <th>Trámite</th>
                  <th>Estado</th>
                  <th>Trabajador</th>
                  <th>Operaciones</th>
                </tr>
              </thead>
              <tbody>
                {analysisLoading ? <tr><td colSpan={6} className="analysis-loading-cell"><span className="session-check-spinner" aria-hidden="true" /><span>Cargando atenciones…</span></td></tr> : analysis.map((t: any) => (
                  <tr key={t.id} className="analysis-ticket-row" tabIndex={0} role="button" aria-label={`Abrir detalle del ticket ${t.code}`} onClick={() => setSelectedAnalysisId(t.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedAnalysisId(t.id); } }}>
                    <td>{t.code}</td>
                    <td>{t.clientName}</td>
                    <td>{t.service.name}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td>{t.assignedTo?.name || "—"}</td>
                    <td>{t.operations.length}</td>
                  </tr>
                ))}
                {!analysisLoading && !analysis.length && <tr><td colSpan={6} className="analysis-empty-cell">No hay atenciones para los filtros seleccionados.</td></tr>}
              </tbody>
            </table>
          </div>
          {selectedAnalysisId !== null && analysis.some((ticket: any) => ticket.id === selectedAnalysisId) && (() => {
            const ticket = analysis.find((item: any) => item.id === selectedAnalysisId);
            return <WorkerHistory key={ticket.id} tickets={[ticket]} banks={data.banks} managerMode initialSelectedId={ticket.id} onClose={() => setSelectedAnalysisId(null)} onChanged={async (message) => { setInfo(message); await reloadAnalysis(); }} />;
          })()}
        </section>
      )}
    </section>
  );
}
function AttentionTimeRanking({ workers }: { workers: Data["workerPerformance"] }) {
  const ranked = workers
    .filter((worker) => worker.attentions > 0 && Number.isFinite(worker.avgAttention) && worker.avgAttention > 0)
    .sort((a, b) => a.avgAttention - b.avgAttention);
  const formatAttention = (minutes: number) => {
    const seconds = Math.round(minutes * 60);
    const wholeMinutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return wholeMinutes ? wholeMinutes + " min " + remainingSeconds + " s" : remainingSeconds + " s";
  };
  return <section className="attention-ranking" aria-label="Ranking de menor tiempo de atención">
    <div className="attention-ranking-heading"><div><span className="eyebrow">RANKING DE ATENCIÓN</span><h3>Asesores con menor tiempo de atención</h3><p>Promedio desde que inicia la atención hasta que finaliza; no incluye la espera en cola.</p></div></div>
    {ranked.length ? <div className="attention-ranking-table-wrap"><table className="attention-ranking-table"><thead><tr><th>#</th><th>Asesor</th><th>Atendidos</th><th>Tiempo prom.</th></tr></thead><tbody>{ranked.map((worker, index) => <tr key={worker.id}><td className="attention-rank-place">{index < 3 ? ["🥇", "🥈", "🥉"][index] : index + 1}</td><td className="attention-rank-name">{worker.name}</td><td>{worker.attentions}</td><td className="attention-rank-time">{formatAttention(worker.avgAttention)}</td></tr>)}</tbody></table></div> : <p className="empty attention-ranking-empty">Todavía no hay atenciones completadas suficientes para armar el ranking.</p>}
  </section>;
}
function PerformanceTable({ workers }: { workers: Data["workerPerformance"] }) {
  const orderedWorkers = [...workers].sort((a, b) => b.attentions - a.attentions || a.name.localeCompare(b.name, "es"));
  return <div className="table-wrap"><table><thead><tr><th>Trabajador</th><th>Atenciones</th><th>% atendidos</th><th>Volumen</th><th>Utilidad</th><th>Ticket prom.</th><th>Atención prom.</th></tr></thead><tbody>{orderedWorkers.map((worker) => <tr key={worker.id}><td><div className="name-cell"><span className="avatar">{initials(worker.name)}</span>{worker.name}</div></td><td>{worker.attentions}</td><td>{worker.attendanceShare.toFixed(0)}%</td><td>{money(worker.volume)}</td><td>{money(worker.profit)}</td><td>{money(worker.avgTicket)}</td><td>{Math.round(worker.avgAttention)} min</td></tr>)}</tbody></table></div>;
}
function BankBrand({ name }: { name: string }) {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const brand = normalized.includes("bcp") ? "bcp"
    : normalized.includes("bbva") ? "bbva"
      : normalized.includes("interbank") ? "interbank"
        : normalized.includes("scotiabank") ? "scotiabank"
          : normalized.includes("banbif") ? "banbif" : "";
  if (!brand) return <>{name}</>;
  return <span className={`bank-brand bank-brand-${brand}`} role="img" aria-label={name} title={name}>
    <img className={`bank-logo-image bank-logo-image-${brand}`} src={appAsset(`/banks/${brand}.png`)} alt="" />
  </span>;
}
function DebtCardPicker({ customer, banks, selectedKey, selectedBankId, onSelect, onSelectBank }: {
  customer: PancakeDniCustomer | null;
  banks: { id: number; name: string }[];
  selectedKey?: string;
  selectedBankId: number | null;
  onSelect: (card: ReturnType<typeof getRegisteredCards>[number]) => void;
  onSelectBank: (bankId: number | null) => void;
}) {
  const allowedBanks = new Set(["BCP", "BBVA", "BanBif", "Scotiabank", "Interbank"]);
  const cards = getRegisteredCards(customer, banks).filter(card => allowedBanks.has(card.bankName) && card.bankId !== null);
  if (!cards.length) return <BankSelect banks={banks} value={selectedBankId} placeholder="Selecciona banco" onChange={onSelectBank} />;
  return <div className="debt-card-picker">
    <span className="debt-card-picker-label">Tarjeta del cliente</span>
    <div className="registered-card-options debt-registered-card-options">
      {cards.map((card, index) => <button
        type="button"
        key={`${card.key}:${index}`}
        className={`registered-card-choice${selectedKey === card.key ? " is-selected" : ""}`}
        aria-pressed={selectedKey === card.key}
        onClick={() => onSelect(card)}
      >
        <BankLogo bankKey={card.bankKey} name={card.bankName} />
        <span>{card.lastFour ? `•••• ${card.lastFour}` : card.bankName}</span>
      </button>)}
    </div>
  </div>;
}
function BankSelect({ banks, value, defaultValue, onChange, name, placeholder = "Selecciona banco", ariaLabel = "Banco" }: {
  banks: { id: number; name: string }[];
  value?: number | null;
  defaultValue?: number | null;
  onChange?: (value: number | null) => void;
  name?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState<number | null>(defaultValue ?? banks[0]?.id ?? null);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedId = value === undefined ? internalValue : value;
  const selectedBank = banks.find((bank) => bank.id === selectedId);
  useEffect(() => {
    if (value === undefined && !banks.some((bank) => bank.id === internalValue)) {
      setInternalValue(defaultValue ?? banks[0]?.id ?? null);
    }
  }, [banks, defaultValue, internalValue, value]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  function chooseBank(id: number) {
    if (value === undefined) setInternalValue(id);
    onChange?.(id);
    setOpen(false);
  }
  return <div ref={rootRef} className="bank-picker">
    {name && <input type="hidden" name={name} value={selectedId ?? ""} />}
    <button type="button" className="bank-picker-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
      {selectedBank ? <BankBrand name={selectedBank.name} /> : <span className="bank-picker-placeholder">{placeholder}</span>}
      <span aria-hidden="true" className="bank-picker-chevron">⌄</span>
    </button>
    {open && <div role="listbox" aria-label={ariaLabel} className="bank-picker-menu">
      {banks.map((bank) => <button type="button" role="option" aria-selected={bank.id === selectedId} className="bank-picker-option" key={bank.id} onClick={() => chooseBank(bank.id)}>
        <span>{bank.name}</span>{bank.id === selectedId && <span className="bank-picker-check" aria-hidden="true">✓</span>}
      </button>)}
      {!banks.length && <div className="bank-picker-empty">No hay bancos disponibles</div>}
    </div>}
  </div>;
}
function BankOperationTable({ rows }: { rows: Data["bankPerformance"] }) {
  const services = ["Pago de deuda", "Efectivización"];
  return <section className="panel indicator-table-panel">
    <div className="section-heading"><div><span className="eyebrow">DETALLE FINANCIERO</span><h2>Operaciones bancarias</h2><p>Solo incluye operaciones guardadas en tickets finalizados.</p></div></div>
    <div className="bank-service-columns">
      {services.map((service) => {
        const serviceRows = rows.filter((row) => row.service === service);
        const totalOperations = serviceRows.reduce((sum, row) => sum + row.operations, 0);
        return <article className="bank-service-column" key={service}>
          <div className="bank-service-heading"><h3>{service}</h3><span>{totalOperations} operación(es)</span></div>
          <div className="table-wrap"><table>
            <thead><tr><th>Banco</th><th>Operaciones</th><th>Monto operado</th><th>Comisión / utilidad</th></tr></thead>
            <tbody>{serviceRows.map((row) => <tr key={`${row.service}-${row.bank}-${row.commercialChannel || ""}`}><td><BankBrand name={row.bank} />{row.commercialChannel && <small className="bank-channel-label">{row.commercialChannel === "PAYMENT_LINK" ? "Link de pago" : "POS"}</small>}</td><td>{row.operations}</td><td>{money(row.volume)}</td><td>{money(row.profit)}</td></tr>)}
              {!serviceRows.length && <tr><td colSpan={4}>Sin operaciones en este período.</td></tr>}
            </tbody>
          </table></div>
        </article>;
      })}
    </div>
  </section>;
}
function IncompleteTicketsTable({ rows }: { rows: Data["incompleteByService"] }) {
  return <section className="panel indicator-table-panel"><div className="section-heading"><div><span className="eyebrow">RESULTADO DE LA ATENCIÓN</span><h2>Tickets no completados por trámite</h2></div></div><div className="table-wrap"><table><thead><tr><th>Trámite</th><th>Fallidos</th><th>Cancelados</th><th>Total no completados</th></tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.failed}</td><td>{row.cancelled}</td><td><b>{row.failed + row.cancelled}</b></td></tr>)}{!rows.length && <tr><td colSpan={4}>No hay tickets fallidos ni cancelados en este período.</td></tr>}</tbody></table></div></section>;
}
function DistrictOriginsDashboard({ data }: { data: DistrictOriginsData }) {
  const [branchFilter, setBranchFilter] = useState("");
  const selectedBranch = data.branches.find((branch) => String(branch.branchId) === branchFilter);
  const ranking = selectedBranch?.districts || data.districts;
  const reported = selectedBranch?.reported ?? data.reported;
  const topDistrict = ranking[0];
  const maxCount = Math.max(1, ...ranking.map((row) => row.count));
  const rankedRows = ranking.slice(0, 10);
  return <div className="district-origin-dashboard">
    <div className="district-origin-kpis">
      <article><span>Clientes registrados</span><b>{selectedBranch?.total ?? data.total}</b><small>Tickets recibidos en el período</small></article>
      <article><span>Distrito informado</span><b>{reported}</b><small>{selectedBranch?.withoutDistrict ?? data.withoutDistrict} ticket(s) sin dato</small></article>
      <article><span>Mayor procedencia</span><b>{topDistrict ? `${topDistrict.district} · ${topDistrict.percentage.toFixed(1)}%` : "Sin datos"}</b><small>{topDistrict ? `${topDistrict.count} cliente(s), sobre los distritos informados` : "Se mostrará al registrar distritos"}</small></article>
    </div>
    <section className="district-origin-branches">
      <div className="section-heading"><div><span className="eyebrow">MAYOR PROCEDENCIA</span><h3>Distrito principal por sede</h3><p>Porcentaje calculado sobre clientes con distrito registrado en cada sede.</p></div></div>
      <div className="district-branch-cards">{data.branches.map((branch) => <article key={branch.branchId}>
        <span>{branch.branchName}</span><b>{branch.topDistrict || "Sin datos"}</b><strong>{branch.topDistrict ? `${branch.topPercentage.toFixed(1)}%` : "—"}</strong>
        <small>{branch.topDistrict ? `${branch.topCount} de ${branch.reported} clientes con distrito` : `${branch.total} tickets en el período`}</small>
      </article>)}</div>
    </section>
    <section className="district-origin-ranking">
      <div className="section-heading"><div><span className="eyebrow">DISTRIBUCIÓN</span><h3>Clientes por distrito</h3><p>Porcentaje dentro de la selección; los tickets antiguos sin distrito se muestran aparte.</p></div>
        <label>Sede<select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="">Todas las sedes</option>{data.branches.map((branch) => <option key={branch.branchId} value={branch.branchId}>{branch.branchName}</option>)}</select></label>
      </div>
      {rankedRows.length ? <div className="district-ranking-list">{rankedRows.map((row, index) => <div className="district-ranking-row" key={row.district}>
        <b className="district-ranking-position">{index + 1}</b><span>{row.district}</span><div className="district-ranking-track"><i style={{ width: `${row.count / maxCount * 100}%` }} /></div><strong>{row.percentage.toFixed(1)}%</strong><small>{row.count}</small>
      </div>)}</div> : <p className="empty">Todavía no hay tickets con distrito registrado en este período.</p>}
      {ranking.length > 10 && <details className="district-origin-more"><summary>Ver todos los distritos ({ranking.length})</summary><div className="table-wrap"><table><thead><tr><th>Distrito</th><th>Clientes</th><th>Porcentaje</th></tr></thead><tbody>{ranking.slice(10).map((row) => <tr key={row.district}><td>{row.district}</td><td>{row.count}</td><td>{row.percentage.toFixed(1)}%</td></tr>)}</tbody></table></div></details>}
    </section>
  </div>;
}
function BranchComparisonDashboard({ data }: { data: BranchComparisonData }) {
  const [view, setView] = useState<"summary" | "services" | "banks" | "trend">("summary");
  const [bankBranchFilter, setBankBranchFilter] = useState("");
  const [bankServiceFilter, setBankServiceFilter] = useState("");
  const [bankFilter, setBankFilter] = useState("");
  const ranked = [...data.branches].sort((a, b) => b.profit - a.profit);
  const totalProfit = data.branches.reduce((sum, row) => sum + row.profit, 0);
  const totalVolume = data.branches.reduce((sum, row) => sum + row.volume, 0);
  const totalOperations = data.branches.reduce((sum, row) => sum + row.operations, 0);
  const topProfit = ranked[0];
  const topOps = [...data.branches].sort((a, b) => b.operations - a.operations)[0];
  const serviceOptions = [...new Set(data.banks.map((row) => row.service))].sort((a, b) => a.localeCompare(b, "es"));
  const bankOptions = [...new Set(data.banks.map((row) => row.bank))].sort((a, b) => a.localeCompare(b, "es"));
  const visibleBankRows = data.banks.filter((row) =>
    (!bankBranchFilter || String(row.branchId) === bankBranchFilter) &&
    (!bankServiceFilter || row.service === bankServiceFilter) &&
    (!bankFilter || row.bank === bankFilter),
  );
  const nav: { id: typeof view; label: string }[] = [
    { id: "summary", label: "Resumen" }, { id: "services", label: "Por trámite" }, { id: "banks", label: "Por banco" }, { id: "trend", label: "Tendencia" },
  ];
  return <div className="branch-compare-dashboard">
    <div className="branch-compare-kpis">
      <article><span>Utilidad total</span><b className="positive">{money(totalProfit)}</b><small>Comisiones registradas en las tres sedes</small></article>
      <article><span>Operaciones</span><b>{totalOperations}</b><small>Conteo de operaciones; un ticket puede tener varias</small></article>
      <article><span>Monto operado</span><b>{money(totalVolume)}</b><small>Bruto: neto más comisión</small></article>
      <article><span>Mayor utilidad</span><b>{topProfit?.branchName || "—"}</b><small>{topProfit ? money(topProfit.profit) : money(0)}</small></article>
    </div>
    <div className="branch-compare-tabs" role="tablist" aria-label="Detalle de comparación por sede">
      {nav.map((item) => <button key={item.id} type="button" role="tab" aria-selected={view === item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>{item.label}</button>)}
    </div>
    {view === "summary" && <section className="branch-compare-view">
      <div className="section-heading"><div><span className="eyebrow">RANKING DEL PERÍODO</span><h3>Comparación general</h3><p>Ordenado por utilidad. Las atenciones se cuentan por ticket y las operaciones por cada registro financiero.</p></div></div>
      <div className="table-wrap branch-compare-table"><table><thead><tr><th>Sede</th><th>Tickets recibidos</th><th>Completados</th><th>Fallidos</th><th>Operaciones</th><th>Monto operado</th><th>Monto neto</th><th>Utilidad</th></tr></thead><tbody>{ranked.map((row, index) => <tr key={row.branchId}><td><span className="branch-rank">{index + 1}</span><b>{row.branchName}</b></td><td>{row.received}</td><td>{row.completed}</td><td>{row.failed + row.cancelled}</td><td><b>{row.operations}</b></td><td>{money(row.volume)}</td><td>{money(row.netVolume)}</td><td className="positive"><b>{money(row.profit)}</b></td></tr>)}</tbody></table></div>
      {topOps && <p className="branch-comparison-insight"><b>{topOps.branchName}</b> registra más operaciones ({topOps.operations}); <b>{topProfit?.branchName || "—"}</b> lidera en utilidad. El mayor volumen no necesariamente significa mayor utilidad.</p>}
    </section>}
    {view === "services" && <section className="branch-compare-view">
      <div className="branch-service-breakdowns">{["Efectivización", "Pago de deuda"].map((serviceName) => {
        const serviceRows = data.services.filter((row) => row.service === serviceName);
        return <article className="branch-service-card" key={serviceName}><div className="section-heading"><div><span className="eyebrow">OPERACIONES POR SEDE</span><h3>{serviceName}</h3></div><b className="summary-pill">{serviceRows.reduce((sum, row) => sum + row.operations, 0)} operaciones</b></div>
          <div className="table-wrap"><table><thead><tr><th>Sede</th><th>Operaciones</th><th>Tickets</th><th>Monto bruto</th><th>Neto</th><th>Utilidad</th></tr></thead><tbody>{data.branches.map((branch) => { const row = serviceRows.find((item) => item.branchId === branch.branchId); return <tr key={branch.branchId}><td><b>{branch.branchName}</b></td><td>{row?.operations || 0}</td><td>{row?.tickets || 0}</td><td>{money(row?.volume || 0)}</td><td>{money(row?.netVolume || 0)}</td><td className="positive">{money(row?.profit || 0)}</td></tr>; })}</tbody></table></div>
        </article>;
      })}</div>
    </section>}
    {view === "banks" && <section className="branch-compare-view"><div className="section-heading"><div><span className="eyebrow">DETALLE FINANCIERO</span><h3>Operaciones por sede, trámite y banco</h3><p>Elige los datos que quieres comparar.</p></div></div>
      <div className="branch-bank-filters" aria-label="Filtrar operaciones por sede, trámite y banco">
        <label>Sede<select value={bankBranchFilter} onChange={(event) => setBankBranchFilter(event.target.value)}><option value="">Todas las sedes</option>{data.branches.map((branch) => <option key={branch.branchId} value={branch.branchId}>{branch.branchName}</option>)}</select></label>
        <label>Trámite<select value={bankServiceFilter} onChange={(event) => setBankServiceFilter(event.target.value)}><option value="">Todos los trámites</option>{serviceOptions.map((service) => <option key={service} value={service}>{service}</option>)}</select></label>
        <label>Banco<select value={bankFilter} onChange={(event) => setBankFilter(event.target.value)}><option value="">Todos los bancos</option>{bankOptions.map((bank) => <option key={bank} value={bank}>{bank}</option>)}</select></label>
      </div>
      <div className="table-wrap branch-compare-table branch-bank-table"><table><thead><tr><th>Sede</th><th>Trámite</th><th>Banco</th><th>Operaciones</th><th>Monto bruto</th><th>Neto</th><th>Utilidad</th></tr></thead><tbody>{visibleBankRows.map((row) => <tr key={`${row.branchId}-${row.service}-${row.bank}-${row.commercialChannel || ""}`}><td><b>{row.branchName}</b></td><td>{row.service}</td><td><BankBrand name={row.bank} />{row.commercialChannel && <small className="bank-channel-label">{row.commercialChannel === "PAYMENT_LINK" ? "Link de pago" : "POS"}</small>}</td><td>{row.operations}</td><td>{money(row.volume)}</td><td>{money(row.netVolume)}</td><td className="positive">{money(row.profit)}</td></tr>)}{!visibleBankRows.length && <tr><td colSpan={7}>No hay operaciones que coincidan con estos filtros.</td></tr>}</tbody></table></div>
    </section>}
    {view === "trend" && <BranchProfitTrend data={data} />}
  </div>;
}

function BranchProfitTrend({ data }: { data: BranchComparisonData }) {
  const [metric, setMetric] = useState<"profit" | "operations">("profit");
  const [hovered, setHovered] = useState<{ branchId: number; index: number } | null>(null);
  const palette = ["#4d9fff", "#43d6a3", "#ffb454", "#c084fc"];
  const width = 760, height = 230, left = 54, right = 52, top = 18, bottom = 182;
  const plotWidth = width - left - right, plotHeight = bottom - top;
  const max = Math.max(1, ...data.trend.flatMap((point) => point.values.map((value) => metric === "profit" ? value.profit : value.operations)));
  const xAt = (index: number) => data.trend.length <= 1 ? left + plotWidth / 2 : left + index * plotWidth / (data.trend.length - 1);
  const yAt = (value: number) => bottom - value / max * plotHeight;
  const labelIndexes = new Set(data.trend.length <= 8 ? data.trend.map((_, index) => index) : Array.from({ length: 8 }, (_, index) => Math.round(index * (data.trend.length - 1) / 7)));
  const series = data.branches.map((branch, branchIndex) => ({
    branch,
    color: palette[branchIndex % palette.length],
    points: data.trend.map((bucket, index) => {
      const value = bucket.values.find((row) => row.branchId === branch.branchId);
      return { x: xAt(index), y: yAt(metric === "profit" ? value?.profit || 0 : value?.operations || 0) };
    }),
  }));
  const smoothPath = (points: { x: number; y: number }[]) => {
    if (!points.length) return "";
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let index = 0; index < points.length - 1; index++) {
      const first = points[index], second = points[index + 1];
      const previous = points[index - 1] || first, next = points[index + 2] || second;
      const c1 = { x: first.x + (second.x - previous.x) / 6, y: Math.max(top, Math.min(bottom, first.y + (second.y - previous.y) / 6)) };
      const c2 = { x: second.x - (next.x - first.x) / 6, y: Math.max(top, Math.min(bottom, second.y - (next.y - first.y) / 6)) };
      path += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${second.x} ${second.y}`;
    }
    return path;
  };
  const hoveredBucket = hovered ? data.trend[hovered.index] : null;
  const hoveredPoint = hovered ? series.find((item) => item.branch.branchId === hovered.branchId)?.points[hovered.index] : null;
  return <section className="branch-compare-view branch-trend-view">
    <div className="section-heading"><div><span className="eyebrow">EVOLUCIÓN DEL PERÍODO</span><h3>{metric === "profit" ? "Utilidad por sede" : "Operaciones por sede"}</h3><p>{metric === "profit" ? "Comisiones registradas en el tiempo." : "Cantidad de operaciones registradas en el tiempo."}</p></div><div className="branch-trend-toggle"><button type="button" className={metric === "profit" ? "active" : ""} onClick={() => setMetric("profit")}>Utilidad</button><button type="button" className={metric === "operations" ? "active" : ""} onClick={() => setMetric("operations")}>Operaciones</button></div></div>
    {!data.trend.length ? <p className="empty">No hay datos para graficar en el período.</p> : <div className="branch-profit-chart-wrap"><svg className="branch-profit-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metric === "profit" ? "Utilidad" : "Operaciones"} comparadas por sede`} onMouseLeave={() => setHovered(null)}>
      <defs><linearGradient id="branch-chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4d9fff" stopOpacity=".22"/><stop offset="100%" stopColor="#4d9fff" stopOpacity="0"/></linearGradient><filter id="branch-chart-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      {Array.from({ length: 5 }, (_, index) => { const value = max * (4 - index) / 4; const y = top + plotHeight * index / 4; return <g key={index}><line x1={left} x2={width - right} y1={y} y2={y} className="branch-chart-grid"/><text x={left - 10} y={y + 4} textAnchor="end" className="branch-chart-axis">{metric === "profit" ? money(value).replace("PEN", "").replace("S/", "S/") : Math.round(value)}</text></g>; })}
      {series[0] && <path d={`${smoothPath(series[0].points)} L ${series[0].points[series[0].points.length - 1]?.x || left} ${bottom} L ${series[0].points[0]?.x || left} ${bottom} Z`} fill="url(#branch-chart-fill)"/>}
  {series.map(({ branch, color, points }) => {
        const hasValues = data.trend.some((bucket) => { const value = bucket.values.find((row) => row.branchId === branch.branchId); return Number(metric === "profit" ? value?.profit || 0 : value?.operations || 0) > 0; });
        return <g key={branch.branchId}>{hasValues && <path d={smoothPath(points)} fill="none" stroke={color} strokeWidth="2.7" strokeLinejoin="round" strokeLinecap="round" filter="url(#branch-chart-glow)"/>}{points.map((point, index) => <g key={index} className="branch-chart-point" role="button" tabIndex={0} aria-label={`${branch.branchName}, ${data.trend[index].label}: ${metric === "profit" ? money(data.trend[index].values.find((row) => row.branchId === branch.branchId)?.profit || 0) : `${data.trend[index].values.find((row) => row.branchId === branch.branchId)?.operations || 0} operaciones`}`} onMouseEnter={() => setHovered({ branchId: branch.branchId, index })} onFocus={() => setHovered({ branchId: branch.branchId, index })} onBlur={() => setHovered(null)}><circle cx={point.x} cy={point.y} r="9" fill="transparent"/><circle cx={point.x} cy={point.y} r="3.2" fill={color} pointerEvents="none"/></g>)}</g>;
      })}
      {data.trend.map((bucket, index) => labelIndexes.has(index) ? <text key={`${bucket.label}-${index}`} x={xAt(index)} y={bottom + 24} textAnchor="middle" className="branch-chart-axis">{bucket.label}</text> : null)}
    </svg>{hoveredPoint && hoveredBucket && <div className="branch-chart-hover-tooltip" aria-live="polite"><b>{hoveredBucket.label}</b>{data.branches.map((branch, index) => { const value = hoveredBucket.values.find((row) => row.branchId === branch.branchId); return <span key={branch.branchId}><i style={{ background: palette[index % palette.length] }}/>{branch.branchName} · {metric === "profit" ? money(value?.profit || 0) : `${value?.operations || 0} operaciones`}</span>; })}</div>}</div>}
    <div className="branch-trend-legend">{data.branches.map((branch, index) => <span key={branch.branchId}><i style={{ background: palette[index % palette.length] }} />{branch.branchName}</span>)}</div>
  </section>;
}
function DemandBars({ values }: { values: Data["hourlyDemand"] }) {
  const max = Math.max(0, ...values.map((item) => item.tickets));
  return values.some((item) => item.tickets > 0) ? <div className="demand-bars">{values.map((item) => <div className="demand-bar-row" key={item.label}><span>{item.label}</span><div className="demand-bar-track"><i style={{ width: `${max ? item.tickets / max * 100 : 0}%` }} /></div><b>{item.tickets}</b></div>)}</div> : <p className="empty">No se recibieron clientes en el período seleccionado.</p>;
}
function WorkerOperationsTrend({ operations }: { operations: Data["workerTodayOperations"] }) {
  const [hovered, setHovered] = useState<{ index: number; type: "effect" | "debt" } | null>(null);
  const labels = [...Array.from({ length: 10 }, (_, index) => `${String(index + 9).padStart(2, "0")}:00`), "Otros"];
  const buckets = labels.map((label) => ({ label, effect: { count: 0, profit: 0 }, debt: { count: 0, profit: 0 } }));
  const peruParts = (date: string) => Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(date)).map((part) => [part.type, part.value]));
  const today = peruParts(new Date().toISOString());
  const todayKey = `${today.year}-${today.month}-${today.day}`;
  for (const operation of operations) {
    const parts = peruParts(operation.createdAt);
    if (`${parts.year}-${parts.month}-${parts.day}` !== todayKey) continue;
    const hour = Number(parts.hour);
    const index = hour >= 9 && hour < 19 ? hour - 9 : 10;
    const name = operation.service.name.toLocaleLowerCase("es");
    const type = name.includes("efect") ? "effect" : name.includes("deuda") ? "debt" : null;
    if (!type) continue;
    buckets[index][type].count += 1;
    buckets[index][type].profit += Number(operation.profit) || 0;
  }
  const width = 1200, height = 250, left = 58, right = 28, top = 26, bottom = 185;
  const plotWidth = width - left - right, plotHeight = bottom - top;
  const maxCount = Math.max(1, ...buckets.flatMap((bucket) => [bucket.effect.count, bucket.debt.count]));
  const yMax = Math.max(2, Math.ceil(maxCount / 2) * 2);
  const xAt = (index: number) => left + plotWidth * index / (buckets.length - 1);
  const yAt = (count: number) => bottom - count / yMax * plotHeight;
  const series = [
    { id: "effect" as const, label: "Efectivización", color: "#eaf4ff" },
    { id: "debt" as const, label: "Pago de deuda", color: "#348cff" },
  ].map((item) => ({ ...item, points: buckets.map((bucket, index) => ({ x: xAt(index), y: yAt(bucket[item.id].count) })) }));
  const smoothPath = (points: { x: number; y: number }[]) => points.slice(1).reduce((path, point, index) => {
    const first = points[index], previous = points[index - 1] || first, next = points[index + 2] || point;
    const c1x = first.x + (point.x - previous.x) / 6, c1y = first.y + (point.y - previous.y) / 6;
    const c2x = point.x - (next.x - first.x) / 6, c2y = point.y - (next.y - first.y) / 6;
    return `${path} C ${c1x} ${c1y} ${c2x} ${c2y} ${point.x} ${point.y}`;
  }, points.length ? `M ${points[0].x} ${points[0].y}` : "");
  const hoveredSeries = hovered ? series.find((item) => item.id === hovered.type) : null;
  const hoveredPoint = hoveredSeries && hovered ? hoveredSeries.points[hovered.index] : null;
  const hoveredBucket = hovered ? buckets[hovered.index] : null;
  const hoveredStats = hovered && hoveredBucket ? hoveredBucket[hovered.type] : null;
  const tooltipX = hoveredPoint ? Math.max(left, Math.min(width - 218, hoveredPoint.x + 12)) : 0;
  const tooltipY = hoveredPoint ? Math.max(top + 2, hoveredPoint.y - 76) : 0;
  const hasOperations = buckets.some((bucket) => bucket.effect.count || bucket.debt.count);
  return <section className="panel worker-operations-trend">
    <div className="worker-ops-heading"><NavIcon name="chart"/><div><h2>Operaciones de hoy</h2><p>Actividad por hora. Pasa el cursor por un punto para ver operaciones y utilidad.</p></div><span>MI JORNADA</span></div>
    {!hasOperations ? <div className="worker-ops-empty-state"><span><NavIcon name="chart" /></span><b>Aún no hay operaciones hoy</b><p>El movimiento de tu jornada aparecerá aquí.</p></div> : <><div className="worker-ops-chart-scroll"><svg className="worker-ops-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Operaciones de hoy por hora y tipo" onMouseLeave={() => setHovered(null)}>
      {Array.from({ length: 5 }, (_, index) => { const value = yMax * (4 - index) / 4, y = top + plotHeight * index / 4; return <g key={index}><line x1={left} x2={width - right} y1={y} y2={y} className="worker-ops-grid"/><text x={left - 10} y={y + 4} textAnchor="end" className="worker-ops-axis">{Math.round(value)}</text></g>; })}
      {series.map((item) => <g key={item.id}><path d={smoothPath(item.points)} fill="none" stroke={item.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>{item.points.map((point, index) => <g key={index} className="worker-ops-point" role="button" tabIndex={0} aria-label={`${buckets[index].label}, ${item.label}: ${buckets[index][item.id].count} operaciones, utilidad ${money(buckets[index][item.id].profit)}`} onMouseEnter={() => setHovered({ index, type: item.id })} onFocus={() => setHovered({ index, type: item.id })} onBlur={() => setHovered(null)}><circle cx={point.x} cy={point.y} r="11" fill="transparent"/><circle cx={point.x} cy={point.y} r="4" fill={item.color} pointerEvents="none"/></g>)}</g>)}
      {buckets.map((bucket, index) => <text key={bucket.label} x={xAt(index)} y={bottom + 25} textAnchor="middle" className="worker-ops-axis">{bucket.label}</text>)}
      {hoveredPoint && hoveredBucket && hoveredSeries && hoveredStats && <g className="worker-ops-tooltip" pointerEvents="none"><rect x={tooltipX} y={tooltipY} width="208" height="68" rx="8"/><circle cx={tooltipX + 13} cy={tooltipY + 16} r="4" fill={hoveredSeries.color}/><text x={tooltipX + 24} y={tooltipY + 19} className="worker-ops-tooltip-title">{hoveredSeries.label} · {hoveredBucket.label}</text><text x={tooltipX + 12} y={tooltipY + 41} className="worker-ops-tooltip-value">Operaciones: {hoveredStats.count}</text><text x={tooltipX + 12} y={tooltipY + 58} className="worker-ops-tooltip-value">Utilidad: {money(hoveredStats.profit)}</text></g>}
    </svg></div>
    <div className="worker-ops-legend">{series.map((item) => <span key={item.id}><i style={{ background: item.color }} />{item.label}</span>)}</div></>}
  </section>;
}
function WorkerHomeDashboard({ data }: { data: Data }) {
  const attentionsToday = data.workerHistory.filter((ticket) => ["COMPLETED", "FAILED", "CANCELLED"].includes(ticket.status));
  const attentionStatus: Record<string, string> = { COMPLETED: "Finalizado", FAILED: "No se acercó", CANCELLED: "Cancelado" };
  return <div className="worker-home-page">
    <section className="worker-home-heading"><h1>Mi atención</h1><p><NavIcon name="team" />{data.user.name} <i>·</i> {data.user.branchName || "Sede"} <i>·</i> Módulo {data.user.moduleNumber || "Sin asignar"}</p></section>
    <section className="worker-home-metrics" aria-label="Resultados de hoy">
      <article className="worker-home-metric"><span className="worker-home-metric-icon"><NavIcon name="team" /></span><div><p className="worker-home-metric-label">En espera</p><b className="worker-home-metric-value">{data.stats.waiting}</b></div></article>
      <article className="worker-home-metric"><span className="worker-home-metric-icon"><NavIcon name="queue" /></span><div><p className="worker-home-metric-label">En atención</p><b className="worker-home-metric-value">{data.stats.inService}</b></div></article>
      <article className="worker-home-metric"><span className="worker-home-metric-icon"><NavIcon name="history" /></span><div><p className="worker-home-metric-label">Finalizados hoy</p><b className="worker-home-metric-value is-positive">{data.stats.completed}</b></div></article>
      <article className="worker-home-metric"><span className="worker-home-metric-icon"><NavIcon name="ticket" /></span><div><p className="worker-home-metric-label">Fallidos hoy</p><b className="worker-home-metric-value">{data.stats.failed}</b></div></article>
    </section>
    <div className="worker-home-lower-grid"><WorkerOperationsTrend operations={data.workerTodayOperations} /><section className="panel worker-financial-summary"><h2><NavIcon name="chart"/>Resumen financiero</h2><article className="worker-financial-card"><div><p className="worker-financial-card-label">Volumen hoy</p><b className="worker-financial-card-value">{money(data.stats.totalAmount)}</b><p className="worker-financial-card-note">Monto total procesado en el día.</p></div><span className="worker-financial-card-icon"><NavIcon name="chart"/></span></article><article className="worker-financial-card"><div><p className="worker-financial-card-label">Utilidad hoy</p><b className="worker-financial-card-value is-positive">{money(data.stats.totalProfit)}</b><p className="worker-financial-card-note">Ganancia neta generada en el día.</p></div><span className="worker-financial-card-icon"><NavIcon name="chart"/></span></article></section></div>
    <section className="panel worker-today-attentions">
      <div className="worker-today-attentions-heading"><div><span className="eyebrow">TU ACTIVIDAD</span><h2>Atenciones de hoy</h2><p>Tickets atendidos por ti durante el día.</p></div><b>{attentionsToday.length}</b></div>
      {attentionsToday.length ? <div className="worker-today-attentions-list">{attentionsToday.map((ticket) => {
        const totalAmount = ticket.operations.reduce((sum, operation) => sum + Number(operation.amount), 0);
        const totalProfit = ticket.operations.reduce((sum, operation) => sum + Number(operation.profit), 0);
        return <article className="worker-today-attention" key={ticket.id}>
          <div><strong>{ticket.code}</strong><span>{ticket.clientName}</span></div>
          <div><b>{ticket.service.name}</b><small>{ticket.completedAt ? new Date(ticket.completedAt).toLocaleTimeString("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit" }) : "Sin hora final"}</small></div>
          <div><span className={`worker-today-status ${ticket.status.toLowerCase()}`}>{attentionStatus[ticket.status] || ticket.status}</span><small>{ticket.operations.length ? `${ticket.operations.length} operación(es) · Vol. ${money(totalAmount)} · Util. ${money(totalProfit)}` : "Sin operaciones registradas"}</small></div>
        </article>;
      })}</div> : <p className="worker-today-attentions-empty">Aún no tienes atenciones cerradas hoy. Tus tickets aparecerán aquí al finalizarse.</p>}
    </section>
  </div>;
}
function WorkerPageHeading({ title, data }: { title: "Mi cola" | "Mi historial"; data: Data }) {
  return <section className="worker-page-heading"><h1>{title}</h1><p><NavIcon name="team" />{data.user.name}<i>·</i>{data.user.branchName || "Sede"}<i>·</i>Módulo {data.user.moduleNumber || "Sin asignar"}</p></section>;
}
function ServiceMixChart({ services }: { services: Data["servicesDistribution"] }) {
  const palette = ["#56d6b1", "#4d9fff", "#ffb454", "#a78bfa", "#f472b6", "#f87171", "#38bdf8"];
  const items = services.map((service, index) => ({ ...service, color: palette[index % palette.length] })).filter((service) => service.count > 0);
  const total = items.reduce((sum, service) => sum + service.count, 0);
  let offset = 0;
  const slices = items.map((service) => {
    const start = offset;
    offset += total ? service.count / total * 100 : 0;
    return `${service.color} ${start}% ${offset}%`;
  });
  const chartStyle = { background: total ? `conic-gradient(${slices.join(", ")})` : "#203954" };
  return total ? <div className="service-mix">
    <div className="service-mix-chart" style={chartStyle} role="img" aria-label={`Distribución de ${total} clientes por trámite`} />
    <div className="service-mix-legend">{items.map((service) => <div className="service-mix-item" key={service.name}><span className="service-mix-dot" style={{ background: service.color }} /><span className="service-mix-name">{service.name}</span><b>{(service.count / total * 100).toFixed(1)}%</b><small>{service.count}</small></div>)}</div>
  </div> : <p className="empty service-mix-empty">Todavía no se recibieron clientes en este período.</p>;
}
function DateRangePicker({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return <div className="date-range"><label>Desde<input type="date" value={from} onChange={(event) => onChange(event.target.value, to || event.target.value)} /></label><label>Hasta<input type="date" min={from || undefined} value={to} onChange={(event) => onChange(from || event.target.value, event.target.value)} /></label>{from && <button className="ghost small" type="button" onClick={() => onChange("", "")}>Limpiar</button>}</div>;
}
function LargeRoomAdvisorPicker({ tickets, selectedIds, onSelectedIds, onAssign, busy, activeCount, branchName }: {
  tickets: Ticket[];
  selectedIds: number[];
  onSelectedIds: (ids: number[]) => void;
  onAssign: () => void;
  busy: boolean;
  activeCount: number;
  branchName: string;
}) {
  return <article className="panel large-room-advisor-picker">
    <div className="panel-title"><div><span className="eyebrow">SALA GRANDE · {branchName}</span><h2>Elige clientes para tu sala</h2><p>Selecciona uno o varios clientes en espera. Seguirán asignados a ti hasta que los atiendas.</p></div><b>{activeCount} en sala</b></div>
    <div className="large-room-waiting-list advisor-room-client-list">{tickets.map((ticket) => {
      const checked = selectedIds.includes(ticket.id);
      return <label key={ticket.id} className={`large-room-client${checked ? " selected" : ""}`}><input type="checkbox" checked={checked} disabled={busy} onChange={(event) => onSelectedIds(event.target.checked ? [...selectedIds, ticket.id] : selectedIds.filter((id) => id !== ticket.id))} /><span><b>{ticket.code} · {ticket.clientName}</b><small>{ticket.service.name}{ticket.isPreferential ? " · Preferencial" : ""}</small></span></label>;
    })}{!tickets.length && <p className="empty">No hay clientes en espera para añadir a la sala.</p>}</div>
    <div className="large-room-assign-footer"><span>{selectedIds.length} seleccionado(s)</span><button type="button" disabled={!selectedIds.length || busy} onClick={onAssign}>{busy ? "Añadiendo…" : "Añadir seleccionados a mi sala"}</button></div>
  </article>;
}

function LargeRoomManagement({ branches, tickets, rooms, onRefresh }: {
  branches: { id: number; name: string }[];
  tickets: Ticket[];
  rooms: any[];
  onRefresh: () => Promise<void>;
}) {
  const [branchId, setBranchId] = useState(0);
  const [selectedTicketIds, setSelectedTicketIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const activeRooms = rooms.filter((item) => item.active);
  const room = rooms.find((item) => item.branchId === branchId);
  const waitingTickets = tickets.filter((ticket) => ticket.branchId === branchId && ticket.status === "WAITING");
  const roomTickets = room?.tickets || [];
  useEffect(() => { if (!branchId && branches.length) setBranchId(branches[0].id); }, [branchId, branches]);
  useEffect(() => { setSelectedTicketIds([]); }, [branchId]);

  async function assignClients() {
    if (!branchId || !selectedTicketIds.length) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await appFetch("/api/admin/large-room", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", branchId, ticketIds: selectedTicketIds }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "No se pudieron asignar los clientes.");
      setMessage(`${result.assigned} cliente(s) asignado(s) a la sala grande.`);
      setSelectedTicketIds([]);
      await onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo conectar.");
      await onRefresh();
    } finally { setBusy(false); }
  }

  return <section className="large-room-admin">
    <article className="panel large-room-config">
      <div className="section-heading"><div><span className="eyebrow">CONTROL DEL ADMINISTRADOR</span><h2>Sala grande</h2><p>El asesor activa la sala y elige clientes desde su cola. Aquí puedes monitorear la sala y ayudar con asignaciones.</p></div><span className={`summary-pill ${activeRooms.length ? "large-room-active-pill" : ""}`}>{activeRooms.length ? `${activeRooms.length} activa(s)` : "Sin salas activas"}</span></div>
      <div className="large-room-active-overview"><span className="eyebrow">SALAS ACTIVAS</span>{activeRooms.map((activeRoom) => <div className="large-room-active-row" key={activeRoom.id}><span><b>{activeRoom.branch.name} · {activeRoom.worker?.name || "Asesor sin nombre"}</b><small>{activeRoom.tickets.length} cliente(s) en sala</small></span><span className="large-room-active-count">● Activa</span></div>)}{!activeRooms.length && <span className="large-room-active-empty">No hay asesores atendiendo desde una sala grande en este momento.</span>}</div>
      <div className="large-room-controls">
        <label>Sede<select value={branchId || ""} onChange={(event) => setBranchId(Number(event.target.value))}><option value="" disabled>Selecciona una sede</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <div className="large-room-room-advisor"><b>{room?.active ? `Asesor: ${room.worker?.name || "Sin nombre"}` : "Sala inactiva"}</b><small>{room?.active ? "El asesor puede salir desde su panel cuando vuelva a su módulo." : "El asesor debe activar la sala desde su panel antes de recibir clientes."}</small></div>
      </div>
      {message && <p className="large-room-message" role="status">{message}</p>}
      <div className="large-room-capacity"><b>{roomTickets.length}</b><span>clientes asignados en sala ahora · sin límite</span></div>
    </article>
    <div className="large-room-columns">
      <article className="panel">
        <div className="panel-title"><div><span className="eyebrow">COLA DE LA SEDE</span><h2>Clientes en espera</h2><p>Selecciona clientes para enviarlos al asesor de la sala.</p></div><b>{waitingTickets.length}</b></div>
        <div className="large-room-waiting-list">{waitingTickets.map((ticket) => {
          const checked = selectedTicketIds.includes(ticket.id);
          const disabled = !room?.active;
          return <label key={ticket.id} className={`large-room-client${checked ? " selected" : ""}`}><input type="checkbox" checked={checked} disabled={disabled || busy} onChange={(event) => setSelectedTicketIds((current) => event.target.checked ? [...current, ticket.id] : current.filter((id) => id !== ticket.id))} /><span><b>{ticket.code} · {ticket.clientName}</b><small>{ticket.service.name}{ticket.isPreferential ? " · Preferencial" : ""}</small></span></label>;
        })}{!waitingTickets.length && <p className="empty">No hay clientes esperando en esta sede.</p>}</div>
        <div className="large-room-assign-footer"><span>{selectedTicketIds.length} seleccionado(s)</span><button type="button" disabled={!room?.active || !selectedTicketIds.length || busy} onClick={() => void assignClients()}>{busy ? "Asignando…" : "Asignar a sala grande"}</button></div>
      </article>
      <article className="panel">
        <div className="panel-title"><div><span className="eyebrow">ATENCIÓN EN CURSO</span><h2>Clientes de la sala</h2><p>Al asignarlos pasan a atención y aparecen en la cola del asesor.</p></div><b>{roomTickets.length}</b></div>
        <div className="large-room-waiting-list">{roomTickets.map((ticket: any) => <div key={ticket.id} className="large-room-assigned-client"><b>{ticket.code} · {ticket.clientName}</b><small>{ticket.service.name} · {ticket.status === "CALLED" ? "Llamado" : "En atención"}</small></div>)}{!roomTickets.length && <p className="empty">Todavía no hay clientes asignados a esta sala.</p>}</div>
      </article>
    </div>
  </section>;
}

function FrequentClientsLink({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className="panel frequent-clients-link" onClick={onOpen}>
    <span><span className="eyebrow">CLIENTES QUE REGRESAN</span><b>Clientes frecuentes</b><small>Personas con dos o más visitas</small></span>
    <span className="frequent-clients-toggle">Ver lista <span aria-hidden="true">↗</span></span>
  </button>;
}
function FrequentClients({ onBack }: { onBack: () => void }) {
  type Client = { name: string; visits: number; lastVisit: string; lastService: string };
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requested = useRef(false);

  async function load() {
    if (requested.current) return;
    requested.current = true;
    setLoading(true);
    setError("");
    try {
      const response = await appFetch("/api/indicators/frequent-clients", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "No se pudo cargar la lista.");
      setClients(result.clients || []);
    } catch (cause) {
      requested.current = false;
      setError(cause instanceof Error ? cause.message : "No se pudo conectar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return <section className="panel frequent-clients-page">
    <div className="frequent-clients-page-header"><div><span className="eyebrow">CLIENTES QUE REGRESAN</span><h2>Clientes frecuentes</h2><p>Personas con dos o más visitas en esta sede.</p></div><div className="frequent-clients-page-actions">{clients.length > 0 && <span className="summary-pill">{clients.length} cliente(s)</span>}<button type="button" className="ghost small" onClick={onBack}>Volver a indicadores</button></div></div>
    <div className="frequent-clients-scroll">{loading ? <p className="empty">Cargando clientes frecuentes…</p> : error ? <div className="frequent-clients-error"><p>{error}</p><button type="button" className="ghost small" onClick={() => void load()}>Reintentar</button></div> : clients.length ? <div className="frequent-clients-list">{clients.map((client, index) => <article className="frequent-client-row" key={`${client.name}-${index}`}><div><b>{client.name}</b><small>Última visita: {new Date(client.lastVisit).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}</small></div><span className="frequent-client-count">{client.visits} visitas</span><small>Último trámite: {client.lastService}</small></article>)}</div> : <p className="empty">Aún no hay clientes con más de una visita en esta sede.</p>}</div>
  </section>;
}
function LineTrend({ values }: { values: Data["trend"] }) {
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const dragStart = useRef<number | null>(null);
  const firstLabel = values[0]?.label;
  const lastLabel = values[values.length - 1]?.label;
  useEffect(() => {
    setZoomRange(null);
    setSelection(null);
    setHoveredIndex(null);
  }, [values.length, firstLabel, lastLabel]);
  if (!values.length) return <p className="empty">Aún no hay tickets para mostrar en este periodo.</p>;
  const visibleRange: [number, number] = zoomRange || [0, values.length - 1];
  const visibleValues = values.slice(visibleRange[0], visibleRange[1] + 1);
  const width = 760, height = 230, left = 42, right = 42, top = 20, bottom = 184;
  const plotWidth = width - left - right, plotHeight = bottom - top;
  const maxTickets = Math.max(1, ...visibleValues.map((item) => item.tickets));
  const maxMinutes = Math.max(10, Math.ceil(Math.max(0, ...visibleValues.flatMap((item) => [item.avgWait, item.avgAttention])) / 10) * 10);
  const points = visibleValues.map((item, index) => ({
    ...item,
    index: visibleRange[0] + index,
    x: visibleValues.length === 1 ? left + plotWidth / 2 : left + index * (plotWidth / (visibleValues.length - 1)),
    yTickets: bottom - (item.tickets / maxTickets) * plotHeight,
    yWait: bottom - (item.avgWait / maxMinutes) * plotHeight,
    yAttention: bottom - (item.avgAttention / maxMinutes) * plotHeight,
  }));
  const smooth = (coords: { x: number; y: number }[]) => {
    if (!coords.length) return "";
    let path = "M " + coords[0].x + " " + coords[0].y;
    for (let index = 0; index < coords.length - 1; index++) {
      const first = coords[index], second = coords[index + 1];
      const previous = coords[index - 1] || first, next = coords[index + 2] || second;
      const control1 = { x: first.x + (second.x - previous.x) / 6, y: first.y + (second.y - previous.y) / 6 };
      const control2 = { x: second.x - (next.x - first.x) / 6, y: second.y - (next.y - first.y) / 6 };
      path += " C " + control1.x + " " + control1.y + " " + control2.x + " " + control2.y + " " + second.x + " " + second.y;
    }
    return path;
  };
  const ticketsPath = smooth(points.map((point) => ({ x: point.x, y: point.yTickets })));
  const waitPath = smooth(points.map((point) => ({ x: point.x, y: point.yWait })));
  const attentionPath = smooth(points.map((point) => ({ x: point.x, y: point.yAttention })));
  const areaPath = ticketsPath + " L " + points[points.length - 1].x + " " + bottom + " L " + points[0].x + " " + bottom + " Z";
  const grid = Array.from({ length: 5 }, (_, index) => ({
    y: top + index * (plotHeight / 4),
    tickets: Math.round(maxTickets * (4 - index) / 4),
    wait: Math.round(maxMinutes * (4 - index) / 4),
  }));
  const pointerIndex = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const fraction = Math.max(0, Math.min(1, (x - left) / plotWidth));
    return Math.round(visibleRange[0] + fraction * (visibleRange[1] - visibleRange[0]));
  };
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    if (x < left || x > width - right || y < top || y > bottom || visibleRange[1] <= visibleRange[0]) return;
    const index = pointerIndex(event);
    dragStart.current = index;
    setSelection([index, index]);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragStart.current !== null) {
      setSelection([dragStart.current, pointerIndex(event)]);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * width;
    const y = ((event.clientY - rect.top) / rect.height) * height;
    if (x < left || x > width - right || y < top || y > bottom) {
      setHoveredIndex(null);
      return;
    }
    setHoveredIndex(pointerIndex(event));
  };
  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragStart.current === null) return;
    const start = dragStart.current;
    const end = pointerIndex(event);
    dragStart.current = null;
    setSelection(null);
    setHoveredIndex(null);
    if (Math.abs(end - start) >= 1) setZoomRange([Math.min(start, end), Math.max(start, end)]);
  };
  const selectionRect = selection && visibleRange[1] > visibleRange[0] ? {
    x: left + (Math.min(...selection) - visibleRange[0]) / (visibleRange[1] - visibleRange[0]) * plotWidth,
    width: Math.max(3, Math.abs(selection[1] - selection[0]) / (visibleRange[1] - visibleRange[0]) * plotWidth),
  } : null;
  const hoveredPoint = points.find((point) => point.index === hoveredIndex);
  return <div className="line-trend" aria-label="Flujo de tickets y tiempo de espera">
    <div className="traffic-legend"><span><i className="arrivals" />Clientes recibidos</span><span><i className="wait" />Espera promedio</span><span><i className="attention" />Atención promedio</span></div>
    <div className="traffic-chart-wrap">
    <svg className="traffic-zoomable" viewBox={"0 0 " + width + " " + height} preserveAspectRatio="none" role="img" aria-label="Gráfico interactivo. Arrastra sobre un tramo para acercarlo." onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onPointerLeave={() => { if (dragStart.current === null) setHoveredIndex(null); }}>
      <defs>
        <linearGradient id="traffic-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#4c9aff" stopOpacity=".32" /><stop offset="100%" stopColor="#4c9aff" stopOpacity="0" /></linearGradient>
        <filter id="traffic-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      {grid.map((line) => <g key={line.y}><line className="traffic-grid-line" x1={left} x2={width - right} y1={line.y} y2={line.y} /><text className="traffic-axis-label" x={left - 9} y={line.y + 3} textAnchor="end">{line.tickets}</text><text className="traffic-axis-label" x={width - right + 9} y={line.y + 3} textAnchor="start">{line.wait}m</text></g>)}
      <path d={areaPath} fill="url(#traffic-fill)" />
      <path className="traffic-line arrivals-line" d={ticketsPath} />
      <path className="traffic-line wait-line" d={waitPath} />
      <path className="traffic-line attention-line" d={attentionPath} />
      {selectionRect && <rect className="traffic-selection" x={selectionRect.x} y={top} width={selectionRect.width} height={plotHeight} />}
      {points.map((point) => <g key={point.label} aria-label={`${point.label}: ${point.tickets} clientes, espera promedio ${point.avgWait.toFixed(1)} minutos, atención promedio ${point.avgAttention.toFixed(1)} minutos`}><circle className="traffic-point arrivals-point" cx={point.x} cy={point.yTickets} r="3.5" /><circle className="traffic-point wait-point" cx={point.x} cy={point.yWait} r="3.5" /><circle className="traffic-point attention-point" cx={point.x} cy={point.yAttention} r="3.5" /></g>)}
    </svg>
    {hoveredPoint && <div className="traffic-tooltip" aria-live="polite"><b className="traffic-tooltip-date">{hoveredPoint.label}</b><span><i className="arrivals" />{hoveredPoint.tickets} cliente(s)</span><span><i className="wait" />Espera promedio {hoveredPoint.avgWait.toFixed(1)} min</span><span><i className="attention" />Atención promedio {hoveredPoint.avgAttention.toFixed(1)} min</span></div>}
    </div>
    <div className="traffic-zoom-controls"><small>{zoomRange ? `Vista ampliada: ${values[visibleRange[0]]?.label} — ${values[visibleRange[1]]?.label}` : "Arrastra sobre el gráfico para acercar un tramo"}</small>{zoomRange && <button type="button" className="ghost small" onClick={() => setZoomRange(null)}>Restablecer vista</button>}</div>
    <div className="line-labels">{points.map((point, index) => <span className={points.length > 12 && index % 2 ? "hide-label-mobile" : ""} key={point.label}>{point.label}<b>{point.tickets} · {point.avgWait.toFixed(0)}m</b></span>)}</div>
    <div className="traffic-axis-caption"><span>Clientes</span><span>Minutos promedio</span></div>
  </div>;
}
function WorkerPermissions({
  worker,
  services,
  branches,
  isAdmin,
  onBranchChange,
  onSave,
  onDelete,
}: {
  worker: any;
  services: any[];
  branches: any[];
  isAdmin: boolean;
  onBranchChange: (userId: number, branchId: number) => void;
  onSave: (id: number, ids: number[], moduleNumber: number | null, dni: string | null, available: boolean) => void;
  onDelete: (id: number, name: string) => void;
}) {
  const [ids, setIds] = useState<number[]>(
    worker.services.map((s: any) => s.service.id),
  );
  const [moduleNumber, setModuleNumber] = useState(worker.moduleNumber ? String(worker.moduleNumber) : "");
  const [dni, setDni] = useState(worker.dni || "");
  const [branchId, setBranchId] = useState(String(worker.branchId || ""));
  return (
    <div className="worker-permissions manage-user-form">
      {isAdmin && <section className="manage-user-section">
        <div className="manage-section-title"><span className="eyebrow">SEDE</span></div>
        <div className="manage-fields manage-branch-field"><label><span>Sede asignada</span><select value={branchId} onChange={(event) => setBranchId(event.target.value)}>{branches.map((branch: any) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><button type="button" className="ghost" disabled={!branchId || Number(branchId) === worker.branchId} onClick={() => onBranchChange(worker.id, Number(branchId))}>Guardar sede</button></div>
      </section>}
      <section className="manage-user-section">
        <div className="manage-section-title"><span className="eyebrow">ATENCIÓN Y ACCESO</span></div>
        <div className="manage-fields">
          <label className="manage-field"><span>Módulo de atención</span><input type="number" min="1" max="99" value={moduleNumber} onChange={(event) => setModuleNumber(event.target.value)} placeholder="Ej. 1" /></label>
          <label className="manage-field"><span>ID / DNI de Registros ATK</span><input inputMode="numeric" pattern="[0-9]{6,12}" value={dni} onChange={(event) => setDni(event.target.value.replace(/\D/g, ""))} placeholder="Ingresa el DNI" /></label>
        </div>
      </section>
      <section className="manage-user-section">
        <div className="manage-section-title"><span className="eyebrow">TRÁMITES AUTORIZADOS</span></div>
        <div className="checks manage-service-checks">{services.map((service) => <label key={service.id}><input type="checkbox" checked={ids.includes(service.id)} onChange={(event) => setIds(event.target.checked ? [...ids, service.id] : ids.filter((id) => id !== service.id))} /><span>{service.name}</span></label>)}</div>
      </section>
      <div className="manage-user-actions"><button type="button" className="danger" onClick={() => onDelete(worker.id, worker.name)}>Eliminar usuario</button><button type="button" onClick={() => onSave(worker.id, ids, moduleNumber ? Number(moduleNumber) : null, dni || null, worker.availability === "AVAILABLE")}>Guardar cambios</button></div>
    </div>
  );
}

function UserAccountSummary({ worker }: { worker: any }) {
  const roleLabel = worker.role === "RECEPTION" ? "Recepción" : "Administrador";
  return <div className="user-account-summary"><span className="eyebrow">TIPO DE CUENTA · {roleLabel.toUpperCase()}</span><p>Esta cuenta se muestra para control administrativo y no participa en la asignación de turnos ni requiere módulo.</p></div>;
}

