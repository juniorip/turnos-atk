import type { PancakeDniCustomer, PancakeDniLookupResult } from "@/lib/pancake";

const PANCAKE_API_V2 = "https://pages.fm/api/public_api/v2";
const MAX_PAGES = 100;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function notes(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(notes);
  const row = record(value);
  if (!row) return [];
  const note = string(row.message) ?? string(row.content) ?? string(row.note);
  return note ? [note] : [];
}

/** Looks for multiple ticket DNIs in one Pancake conversation scan. */
export async function lookupPancakeCustomersByDni(dnis: string[], signal?: AbortSignal): Promise<Map<string, PancakeDniLookupResult>> {
  const uniqueDnis = [...new Set(dnis.map((dni) => dni.replace(/\D/g, "")).filter(Boolean))];
  const results = new Map<string, PancakeDniLookupResult>();
  const pageId = process.env.PANCAKE_PAGE_ID?.trim();
  const pageToken = process.env.PANCAKE_PAGE_ACCESS_TOKEN?.trim();
  if (!pageId || !pageToken) {
    for (const dni of uniqueDnis) results.set(dni, { ok: false, reason: "not_configured" });
    return results;
  }

  const found = new Map<string, PancakeDniCustomer>();
  let cursor: string | null = null;
  let scanned = 0;
  let complete = false;
  let failure: Extract<PancakeDniLookupResult, { ok: false }> | null = null;
  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ page_access_token: pageToken, page_size: "60" });
      if (cursor) query.set("last_conversation_id", cursor);
      const timeout = AbortSignal.timeout(15000);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      const response = await fetch(PANCAKE_API_V2 + "/pages/" + encodeURIComponent(pageId) + "/conversations?" + query, {
        method: "GET", cache: "no-store", signal: requestSignal,
      });
      if (response.status === 401 || response.status === 403) { failure = { ok: false, reason: "unauthorized" }; break; }
      if (!response.ok) { failure = { ok: false, reason: "unavailable" }; break; }
      const payload = record(await response.json().catch(() => null));
      if (!payload) { failure = { ok: false, reason: "invalid_response" }; break; }
      if (payload.success === false) {
        failure = { ok: false, reason: "api_rejected", code: (payload.error_code as string | number | null) ?? null };
        break;
      }
      const conversations = Array.isArray(payload.conversations) ? payload.conversations : Array.isArray(payload.data) ? payload.data : null;
      if (!conversations) { failure = { ok: false, reason: "invalid_response" }; break; }
      scanned += conversations.length;

      for (const item of conversations) {
        const conversation = record(item);
        if (!conversation) continue;
        const sender = record(conversation.from);
        const customers = Array.isArray(conversation.customers) ? conversation.customers.map(record).filter(Boolean) as Record<string, unknown>[] : [];
        const pageCustomer = record(conversation.page_customer) ?? customers.map((customer) => record(customer.page_customer)).find(Boolean) ?? null;
        const aliases = [string(sender?.alias), ...customers.map((customer) => string(customer.alias)), string(pageCustomer?.alias)].filter((alias): alias is string => Boolean(alias));
        const dni = uniqueDnis.find((candidate) => !found.has(candidate) && aliases.some((alias) => alias.replace(/\D/g, "").includes(candidate)));
        if (!dni) continue;
        const alias = aliases.find((candidate) => candidate.replace(/\D/g, "").includes(dni))!;
        const noteValues = [pageCustomer?.notes, ...customers.map((customer) => customer.notes)].flatMap(notes);
        found.set(dni, {
          alias,
          profileName: string(pageCustomer?.name) ?? customers.map((customer) => string(customer.name)).find(Boolean) ?? string(sender?.name),
          notes: [...new Set(noteValues)],
          conversationUpdatedAt: string(conversation.updated_at),
        });
      }
      if (found.size === uniqueDnis.length) { complete = true; break; }
      if (conversations.length < 60) { complete = true; break; }
      const last = record(conversations[conversations.length - 1]);
      const next = string(payload.last_conversation_id) ?? string(payload.next_cursor) ?? string(last?.id);
      if (!next || next === cursor) { complete = true; break; }
      cursor = next;
    }
  } catch {
    failure = { ok: false, reason: "unavailable" };
  }

  for (const dni of uniqueDnis) {
    const customer = found.get(dni) ?? null;
    results.set(dni, customer
      ? { ok: true, found: true, complete: true, scanned, customer }
      : failure || { ok: true, found: false, complete, scanned, customer: null });
  }
  return results;
}
