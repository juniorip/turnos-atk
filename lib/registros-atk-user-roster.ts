import { z } from "zod";

const rosterEntrySchema = z.union([z.string(), z.record(z.string(), z.unknown())]);
const rosterSchema = z.object({
  users: z.array(rosterEntrySchema).optional(),
  inactiveUsers: z.array(rosterEntrySchema).optional(),
});

const identityFields = ["username", "userName", "login", "usuario", "email", "name", "nombre"];
const statusFields = ["status", "estado", "userStatus"];
const inactiveStatuses = new Set(["inactive", "inactivo", "disabled", "desactivado", "baja", "cesado", "retirado", "desvinculado"]);

function normalizeIdentity(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/^@+/, "");
}

function entryIdentities(entry: z.infer<typeof rosterEntrySchema>) {
  if (typeof entry === "string") return [normalizeIdentity(entry)];
  return identityFields.flatMap((field) => {
    const value = entry[field];
    return typeof value === "string" && value.trim() ? [normalizeIdentity(value)] : [];
  });
}

function entryIsActive(entry: z.infer<typeof rosterEntrySchema>) {
  if (typeof entry === "string") return true;
  const active = entry.active ?? entry.isActive ?? entry.enabled ?? entry.isEnabled;
  if (active === false || active === 0 || active === "false") return false;
  const status = statusFields.map((field) => entry[field]).find((value) => typeof value === "string");
  return typeof status !== "string" || !inactiveStatuses.has(normalizeIdentity(status));
}

export type RegistrosATKUserRoster = {
  activeUsernames: Set<string> | null;
  inactiveUsernames: Set<string>;
};

let cachedRoster: RegistrosATKUserRoster = { activeUsernames: null, inactiveUsernames: new Set() };
let lastSync = 0;
let pending: Promise<RegistrosATKUserRoster> | null = null;

/** Reads Registros ATK's current collaborator roster for the admin preview selector. */
export async function registrosATKUserRoster(): Promise<RegistrosATKUserRoster> {
  if (Date.now() - lastSync < 30_000) return cachedRoster;
  if (pending) return pending;

  pending = (async () => {
    const base = process.env.REGISTROS_ATK_URL?.replace(/\/$/, "");
    const secret = process.env.REGISTROS_ATK_SHARED_SECRET;
    if (!base || !secret) return cachedRoster;

    lastSync = Date.now();
    try {
      const response = await fetch(`${base}/api/external/turnos/records`, {
        headers: { "X-Turnos-ATK-Key": secret },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return cachedRoster;
      const parsed = rosterSchema.safeParse(await response.json());
      if (!parsed.success) return cachedRoster;

      const inactiveUsernames = new Set((parsed.data.inactiveUsers || []).flatMap(entryIdentities));
      const activeUsernames = parsed.data.users
        ? new Set(parsed.data.users
            .filter((user) => entryIsActive(user) && !entryIdentities(user).some((identity) => inactiveUsernames.has(identity)))
            .flatMap(entryIdentities))
        : null;
      if (activeUsernames || parsed.data.inactiveUsers) {
        cachedRoster = { activeUsernames, inactiveUsernames };
        lastSync = Date.now();
      }
    } catch {
      // Retain the last successful roster and retry after the next interval.
    }
    return cachedRoster;
  })().finally(() => { pending = null; });

  return pending;
}
