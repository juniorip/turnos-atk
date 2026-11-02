const PANCAKE_API = "https://pages.fm/api/public_api/v1";

export type PancakeConnectionResult =
  | { configured: false; connected: false }
  | { configured: true; connected: true }
  | { configured: true; connected: false; reason: "unauthorized" | "unavailable" | "api_rejected" | "invalid_response"; code?: string | number | null };

/** Checks the page token with Pancake without returning customer data or the token. */
export async function checkPancakeConnection(): Promise<PancakeConnectionResult> {
  const pageId = process.env.PANCAKE_PAGE_ID?.trim();
  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN?.trim();
  if (!pageId || !pageToken) return { configured: false, connected: false };

  const now = Math.floor(Date.now() / 1000);
  const query = new URLSearchParams({
    page_access_token: pageToken,
    since: String(now - 60),
    until: String(now),
    page_number: "1",
    page_size: "1",
    fields: "id",
  });

  try {
    const response = await fetch(`${PANCAKE_API}/pages/${encodeURIComponent(pageId)}/page_customers?${query}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401 || response.status === 403) {
      return { configured: true, connected: false, reason: "unauthorized" };
    }
    if (!response.ok) return { configured: true, connected: false, reason: "unavailable" };
    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { configured: true, connected: false, reason: "invalid_response" };
    }
    // Pancake documents `success` as part of this response. Some compatible
    // responses omit it but still return the documented `customers` array.
    if (payload.success === false) {
      return { configured: true, connected: false, reason: "api_rejected", code: payload.error_code ?? null };
    }
    if (payload.success === true || Array.isArray(payload.customers)) return { configured: true, connected: true };
    return { configured: true, connected: false, reason: "invalid_response" };
  } catch {
    return { configured: true, connected: false, reason: "unavailable" };
  }
}
