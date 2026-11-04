const PANCAKE_API = "https://pages.fm/api/public_api/v1";

export type PancakeConnectionResult =
  | { configured: false; connected: false }
  | { configured: true; connected: true }
  | { configured: true; connected: false; reason: "unauthorized" | "unavailable" | "api_rejected" | "invalid_response"; code?: string | number | null };

export type PancakeCustomerName = { id: string; name: string | null; updated_at?: string };

export type PancakeCustomerListResult =
  | { ok: true; total: number; customers: PancakeCustomerName[] }
  | { ok: false; reason: "not_configured" | "unauthorized" | "unavailable" | "api_rejected" | "invalid_response"; code?: string | number | null };

export type PancakeCustomerSearchResult =
  | { ok: true; total: number; scanned: number; complete: boolean; customers: PancakeCustomerName[] }
  | { ok: false; reason: "not_configured" | "unauthorized" | "unavailable" | "api_rejected" | "invalid_response"; code?: string | number | null };

const PANCAKE_CUSTOMER_SEARCH_START = 946684800; // 2000-01-01 UTC
const PANCAKE_CUSTOMER_SEARCH_PAGE_SIZE = 100;
const PANCAKE_CUSTOMER_SEARCH_MAX_PAGES = 250;

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

/** Reads a limited page of customer names. It never stores or returns the token. */
export async function listPancakeCustomerNames(options: {
  since: number;
  until: number;
  page: number;
  pageSize: number;
}): Promise<PancakeCustomerListResult> {
  const pageId = process.env.PANCAKE_PAGE_ID?.trim();
  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN?.trim();
  if (!pageId || !pageToken) return { ok: false, reason: "not_configured" };

  const query = new URLSearchParams({
    page_access_token: pageToken,
    since: String(options.since),
    until: String(options.until),
    page_number: String(options.page),
    page_size: String(options.pageSize),
    order_by: "updated_at",
    fields: "id,name,updated_at",
  });

  try {
    const response = await fetch(`${PANCAKE_API}/pages/${encodeURIComponent(pageId)}/page_customers?${query}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 401 || response.status === 403) return { ok: false, reason: "unauthorized" };
    if (!response.ok) return { ok: false, reason: "unavailable" };

    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, reason: "invalid_response" };
    if (payload.success === false) return { ok: false, reason: "api_rejected", code: payload.error_code ?? null };
    if (!Array.isArray(payload.customers) || typeof payload.total !== "number") return { ok: false, reason: "invalid_response" };

    const customers = payload.customers.flatMap((customer: unknown) => {
      if (!customer || typeof customer !== "object" || Array.isArray(customer)) return [];
      const row = customer as Record<string, unknown>;
      if (typeof row.id !== "string") return [];
      return [{ id: row.id, name: typeof row.name === "string" ? row.name : null, ...(typeof row.updated_at === "string" ? { updated_at: row.updated_at } : {}) }];
    });
    return { ok: true, total: payload.total, customers };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

/** Searches the title/name Pancake stores for a DNI, without persisting customer data. */
export async function searchPancakeCustomersByDni(dni: string): Promise<PancakeCustomerSearchResult> {
  const pageId = process.env.PANCAKE_PAGE_ID?.trim();
  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN?.trim();
  if (!pageId || !pageToken) return { ok: false, reason: "not_configured" };

  const until = Math.floor(Date.now() / 1000);
  const fetchPage = async (page: number) => {
    const query = new URLSearchParams({
      page_access_token: pageToken,
      since: String(PANCAKE_CUSTOMER_SEARCH_START),
      until: String(until),
      page_number: String(page),
      page_size: String(PANCAKE_CUSTOMER_SEARCH_PAGE_SIZE),
      order_by: "updated_at",
      fields: "id,name,updated_at",
    });
    const response = await fetch(`${PANCAKE_API}/pages/${encodeURIComponent(pageId)}/page_customers?${query}`, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 401 || response.status === 403) return { error: "unauthorized" as const };
    if (!response.ok) return { error: "unavailable" as const };

    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { error: "invalid_response" as const };
    if (payload.success === false) return { error: "api_rejected" as const, code: payload.error_code ?? null };
    if (!Array.isArray(payload.customers) || typeof payload.total !== "number") return { error: "invalid_response" as const };

    const customers = payload.customers.flatMap((customer: unknown) => {
      if (!customer || typeof customer !== "object" || Array.isArray(customer)) return [];
      const row = customer as Record<string, unknown>;
      if (typeof row.id !== "string") return [];
      return [{ id: row.id, name: typeof row.name === "string" ? row.name : null, ...(typeof row.updated_at === "string" ? { updated_at: row.updated_at } : {}) }];
    });
    return { total: payload.total as number, customers };
  };

  try {
    const first = await fetchPage(1);
    if ("error" in first && first.error) return { ok: false, reason: first.error, ...(first.error === "api_rejected" ? { code: first.code } : {}) };

    const pagesToScan = Math.min(Math.ceil(first.total / PANCAKE_CUSTOMER_SEARCH_PAGE_SIZE), PANCAKE_CUSTOMER_SEARCH_MAX_PAGES);
    const digits = dni.replace(/\D/g, "");
    const matches = (rows: PancakeCustomerName[]) => rows.filter((customer) => {
      const titleDigits = (customer.name ?? "").replace(/\D/g, "");
      return titleDigits.includes(digits);
    });
    const found = matches(first.customers);
    let scanned = first.customers.length;

    // Four concurrent calls stay below Pancake's documented limit of 5 requests/second.
    for (let start = 2; start <= pagesToScan; start += 4) {
      const batchPages = Array.from({ length: Math.min(4, pagesToScan - start + 1) }, (_, index) => start + index);
      const batch = await Promise.all(batchPages.map(fetchPage));
      for (const result of batch) {
        if ("error" in result && result.error) return { ok: false, reason: result.error, ...(result.error === "api_rejected" ? { code: result.code } : {}) };
        scanned += result.customers.length;
        found.push(...matches(result.customers));
      }
      if (start + 4 <= pagesToScan) await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return {
      ok: true,
      total: first.total,
      scanned,
      complete: pagesToScan === Math.ceil(first.total / PANCAKE_CUSTOMER_SEARCH_PAGE_SIZE),
      customers: found,
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
