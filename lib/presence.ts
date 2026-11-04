// Background tabs and laptops can throttle timers; allow a wider heartbeat
// window before treating an advisor as disconnected.
export const PRESENCE_TIMEOUT_MS = 180_000;

export function presenceCutoff(now = Date.now()) {
  return new Date(now - PRESENCE_TIMEOUT_MS);
}

export function isRecentlyActive(lastActiveAt: Date | string | null | undefined, now = Date.now()) {
  if (!lastActiveAt) return false;
  const timestamp = lastActiveAt instanceof Date ? lastActiveAt.getTime() : new Date(lastActiveAt).getTime();
  return Number.isFinite(timestamp) && now - timestamp <= PRESENCE_TIMEOUT_MS;
}
