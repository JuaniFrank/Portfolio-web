/**
 * HTTP adapter to the Vercel Python function (`api/yahoo-metadata.py`, §10).
 *
 * Two responsibilities:
 *   - `fetchYahooMetadataBatch`: enrichment shape (§10.3), used by yahoo-catalog.ts.
 *   - `resolveUniverseCurrencies`: the AD-12 currency oracle (§10.3b), used by
 *     catalog-sync.ts before linking (never for enrichment).
 *
 * The `CurrencyVerdict` mapping — HTTP status + one item's body → currency |
 * not-listed | unavailable — is a pure function (`parseCurrencyVerdict`),
 * tested. Only the transport (fetch, batching, base-URL resolution) is
 * untested by convention (Prisma-free but still I/O).
 */

import type { InstrumentType } from "@/lib/generated/prisma";
import { mapWithConcurrency } from "@/lib/utils/concurrency";

const BATCH_SIZE = 25;
const REQUEST_TIMEOUT_MS = 20_000;

export type YahooCatalogMetadata = {
  symbol: string;
  instrumentType: InstrumentType;
  provider: "yahoo";
  providerSymbol: string;
  name: string;
  currencyCode: string;
  taxJurisdiction: string;
  sector?: string;
  industry?: string;
  website?: string;
};

export type CurrencyVerdict =
  | { kind: "currency"; currency: "ARS" | "USD" }
  /** Evidence of absence — Yahoo 404s the symbol (e.g. every AR sovereign/letra). */
  | { kind: "not-listed" }
  /** No evidence at all — timeout, 5xx, malformed body, or an unexpected currency. */
  | { kind: "unavailable" };

type CurrencyResultItem = {
  symbol?: unknown;
  ok?: unknown;
  listed?: unknown;
  currency?: unknown;
  error?: unknown;
};

/**
 * Pure mapping from one item's HTTP status + parsed body to a CurrencyVerdict.
 * Never guesses: anything other than a confirmed ARS/USD reading is either
 * `not-listed` (evidence of absence) or `unavailable` (no evidence at all).
 */
export function parseCurrencyVerdict(
  status: number,
  body: CurrencyResultItem | null | undefined
): CurrencyVerdict {
  if (status === 404) return { kind: "not-listed" };
  if (status < 200 || status >= 300) return { kind: "unavailable" };
  if (!body || typeof body !== "object") return { kind: "unavailable" };
  if (body.ok === false) return { kind: "unavailable" };
  if (body.listed === false) return { kind: "not-listed" };
  if (body.currency === "ARS" || body.currency === "USD") {
    return { kind: "currency", currency: body.currency };
  }
  return { kind: "unavailable" };
}

function resolveBaseUrl(): string {
  if (process.env.INTERNAL_FUNCTION_BASE_URL) return process.env.INTERNAL_FUNCTION_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type BatchItem = { symbol: string; type: InstrumentType };

async function postBatch(
  mode: "metadata" | "currency",
  items: BatchItem[]
): Promise<{ status: number; results: Array<Record<string, unknown>> }> {
  const secret = process.env.INTERNAL_FUNCTION_SECRET;
  // Fail here rather than send an unauthenticated request: the function fails
  // closed too, so a missing secret would otherwise surface as an indistinguishable
  // 401 repeated once per instrument.
  if (!secret) {
    throw new Error("INTERNAL_FUNCTION_SECRET is not set — cannot authenticate against the function");
  }

  const url = `${resolveBaseUrl()}/api/yahoo-metadata`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Token": secret,
    },
    body: JSON.stringify({ mode, items }),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    // The status alone cannot tell the function's own rejection apart from one
    // by an edge that never ran it — Vercel's deployment protection answers 401
    // with HTML, the function with JSON. The body is the only discriminator.
    const body = await res.text().catch(() => "");
    const excerpt = body.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(
      `yahoo-metadata function returned ${res.status} from ${url}${excerpt ? ` — ${excerpt}` : ""}`
    );
  }

  const body = (await res.json()) as { results?: unknown };
  const results = Array.isArray(body.results) ? (body.results as Array<Record<string, unknown>>) : [];
  return { status: res.status, results };
}

/**
 * Enrichment adapter (§10.3). Non-200/transport failure throws; the caller's
 * concurrency wrapper (mapWithConcurrency, T-24/T-52) isolates the failure to
 * that batch — never fails the whole enrichment pass.
 */
export async function fetchYahooMetadataBatch(
  items: BatchItem[]
): Promise<Map<string, YahooCatalogMetadata | null>> {
  const out = new Map<string, YahooCatalogMetadata | null>();
  for (const batch of chunk(items, BATCH_SIZE)) {
    const { results } = await postBatch("metadata", batch);
    for (const item of results) {
      const symbol = typeof item.symbol === "string" ? item.symbol : null;
      if (!symbol) continue;
      const data = item.data;
      if (item.ok !== true || !data || typeof data !== "object") {
        out.set(symbol, null);
        continue;
      }
      const d = data as Record<string, unknown>;
      if (
        typeof d.symbol !== "string" ||
        typeof d.providerSymbol !== "string" ||
        typeof d.name !== "string" ||
        typeof d.currencyCode !== "string" ||
        typeof d.taxJurisdiction !== "string"
      ) {
        out.set(symbol, null);
        continue;
      }
      out.set(symbol, {
        symbol: d.symbol,
        instrumentType:
          batch.find((b) => b.symbol.toUpperCase() === symbol.toUpperCase())?.type ??
          ("STOCK_AR" as InstrumentType),
        provider: "yahoo",
        providerSymbol: d.providerSymbol,
        name: d.name,
        currencyCode: d.currencyCode,
        taxJurisdiction: d.taxJurisdiction,
        sector: typeof d.sector === "string" && d.sector ? d.sector : undefined,
        industry: typeof d.industry === "string" && d.industry ? d.industry : undefined,
        website: typeof d.website === "string" && d.website ? d.website : undefined,
      });
    }
  }
  return out;
}

/** design §9.2: the currency oracle's own budget, separate from enrichment's
 * — unlike enrichment it is NOT best-effort, so exhausting it must surface
 * as `unavailable` for every symbol whose batch never got to run, not as a
 * silent gap. Same concurrency cap as enrichment (ENRICH_CONCURRENCY). */
const CURRENCY_ORACLE_CONCURRENCY = 4;
const CURRENCY_BUDGET_MS = 90_000;

/**
 * AD-12 currency oracle. A symbol missing from the returned map is
 * `unavailable`, never `ARS` — the caller (catalog-sync.ts) must fail closed
 * on a whole run rather than default an unresolved symbol.
 */
export async function resolveUniverseCurrencies(
  items: BatchItem[]
): Promise<Map<string, CurrencyVerdict>> {
  const out = new Map<string, CurrencyVerdict>();
  const batches = chunk(items, BATCH_SIZE);

  const results = await mapWithConcurrency(
    batches,
    CURRENCY_ORACLE_CONCURRENCY,
    async (batch) => {
      const { status, results } = await postBatch("currency", batch);
      return { batch, status, results };
    },
    { budgetMs: CURRENCY_BUDGET_MS }
  );

  for (const [i, result] of results.entries()) {
    const batch = batches[i]!;
    if (result.status !== "fulfilled") {
      // Transport failure, or the budget was exhausted before this batch's
      // turn — every symbol in it is unavailable, never defaulted.
      for (const b of batch) out.set(b.symbol, { kind: "unavailable" });
      continue;
    }

    const { status, results: items2 } = result.value;
    const seen = new Set<string>();
    for (const item of items2) {
      const symbol = typeof item.symbol === "string" ? item.symbol : null;
      if (!symbol) continue;
      seen.add(symbol.toUpperCase());
      out.set(symbol, parseCurrencyVerdict(status, item as CurrencyResultItem));
    }
    // Any symbol the function silently dropped from its response is
    // unavailable, never ARS (design §10.3b).
    for (const b of batch) {
      if (!seen.has(b.symbol.toUpperCase())) out.set(b.symbol, { kind: "unavailable" });
    }
  }
  return out;
}
