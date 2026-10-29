import { z } from "zod";

const rosterSchema = z.object({
  users: z.array(z.object({
    username: z.string().min(1),
    active: z.boolean().optional(),
    status: z.string().optional(),
  }).passthrough()).optional(),
  inactiveUsers: z.array(z.object({ username: z.string().min(1) }).passthrough()).optional(),
});

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

      const inactiveUsernames = new Set((parsed.data.inactiveUsers || []).map((user) => user.username.trim().toLowerCase()));
      const activeUsernames = parsed.data.users
        ? new Set(parsed.data.users
            .filter((user) => {
              const username = user.username.trim().toLowerCase();
              const status = (user.status || "").trim().toLowerCase();
              return user.active !== false
                && !["inactive", "inactivo", "disabled", "desactivado", "baja", "cesado", "retirado", "desvinculado"].includes(status)
                && !inactiveUsernames.has(username);
            })
            .map((user) => user.username.trim().toLowerCase()))
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
