/**
 * Docta Capital client — bond catalog metadata + contractual cashflow.
 *
 * Feature-gated (AD-8): every entry point is a no-op unless both
 * `DOCTA_CLIENT_ID` and `DOCTA_CLIENT_SECRET` are set.
 *
 * Token: `POST /auth/token` (`client_credentials`), held in module-scope
 * memory only, refreshed at `expires_in - 300s`. NEVER persisted to `.env`
 * or any durable store (serverless cold starts mint a fresh one — accepted,
 * design R-4).
 *
 * MEASURED (2026-09-16, against the live "basic" plan service — corrects an
 * earlier, unverified "essentially free" assumption that made it into the
 * design):
 *   - `GET /bonds/instruments/{TICKER}` — NO trailing slash. A trailing
 *     slash (`/bonds/instruments/{TICKER}/`, exactly as an earlier design
 *     revision documented it) returns HTTP 404 on the live service.
 *   - The account is rate-limited at **10 requests/minute** AND
 *     **15 requests/day** (`x-ratelimit-limit: 10`, `x-dailylimit-limit: 15`,
 *     observed `x-dailylimit-remaining: 0` and `retry-after` in the tens of
 *     thousands of seconds once exhausted). Callers MUST budget live calls
 *     accordingly — see `docta-linking-plan.ts` and
 *     `fixed-income-linking.ts`'s `DOCTA_LINKING_BUDGET_PER_RUN`. This
 *     module does not retry a 429 at all: against a daily cap, a retry
 *     within the same run cannot succeed, and an earlier version that
 *     honored a live `Retry-After` (measured up to ~18h) literally hung a
 *     caller for minutes before being caught. A 429 is reported to the
 *     caller as `{ kind: "rate-limited" }` immediately, once, no wait.
 *
 * Caching: a definitive HTTP 404 ("this ticker is not in Docta") is
 * PERMANENT and cached exactly like a successful response — Docta's catalog
 * membership does not change day to day, so re-asking is pure quota waste
 * (this is exactly what let the trailing-slash bug silently re-burn the
 * whole daily quota on a second run: every "404" was discarded instead of
 * remembered). A `429` or a transport/parse error is NEVER cached — neither
 * is evidence about the ticker, only about this attempt.
 */

import { prisma } from "@/lib/prisma";

const BASE_URL = "https://api.doctacapital.com.ar/api/v1";
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;

export type DoctaInstrumentResponse = {
  data: Array<{
    ticker: string;
    name: string;
    asset_class?: string;
    sub_asset_class?: string;
    sector?: string;
    issuer?: string;
    law?: string;
    isin?: string | null;
  }>;
};

export type DoctaCashflowResponse = {
  ticker: string;
  data: Array<{
    issue_date: string;
    payment_date: string;
    capital: number;
    interest_rate: number;
    interest_amount: number;
    residual_value: number;
    cash_flow: number;
  }>;
};

/**
 * Every Docta lookup returns one of four outcomes, and callers MUST handle
 * them differently:
 *   - `ok` / `not-found`: evidence. Cached permanently (see module docstring).
 *   - `rate-limited`: the day's (or minute's) budget is spent. A caller
 *     driving a loop over many tickers MUST stop starting new lookups this
 *     run, not continue — every subsequent call would also be `rate-limited`.
 *   - `error`: a transport/parse failure. No evidence either way; safe to
 *     retry on a later run, never cached.
 */
export type DoctaLookupResult<T> =
  | { kind: "ok"; data: T; cached: boolean }
  | { kind: "not-found"; cached: boolean }
  | { kind: "rate-limited" }
  | { kind: "error" };

type CachedDoctaPayload = {
  /** `null` = a confirmed, permanent 404 for this endpoint. Absent key =
   * never resolved yet (neither ok nor 404). */
  instrument?: DoctaInstrumentResponse | null;
  cashflow?: DoctaCashflowResponse | null;
};

let tokenState: { token: string; expiresAt: number } | null = null;

export function isDoctaEnabled(): boolean {
  return Boolean(process.env.DOCTA_CLIENT_ID && process.env.DOCTA_CLIENT_SECRET);
}

async function mintToken(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: process.env.DOCTA_CLIENT_ID,
        client_secret: process.env.DOCTA_CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[docta-client] token mint failed: HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (typeof body.access_token !== "string") {
      console.warn("[docta-client] token mint: malformed response");
      return null;
    }
    const expiresInMs = (typeof body.expires_in === "number" ? body.expires_in : 86_400) * 1000;
    tokenState = { token: body.access_token, expiresAt: Date.now() + expiresInMs - TOKEN_REFRESH_SKEW_MS };
    return tokenState.token;
  } catch (error) {
    console.warn(`[docta-client] token mint error: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Reuses the cached token within its `expires_in` window (Scenario FR-10-A);
 * mints a new one otherwise. Never persisted. */
async function getToken(): Promise<string | null> {
  if (tokenState && Date.now() < tokenState.expiresAt) return tokenState.token;
  return mintToken();
}

/** Raw transport call — no caching (callers own that), no retry on 429. */
async function doctaGet<T>(path: string): Promise<DoctaLookupResult<T>> {
  if (!isDoctaEnabled()) return { kind: "error" };
  const token = await getToken();
  if (!token) return { kind: "error" };

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    if (res.status === 429) {
      console.warn(
        `[docta-client] 429 on ${path} — daily/per-minute quota exhausted ` +
          `(measured: x-dailylimit-limit=15/day, x-ratelimit-limit=10/min). Not retrying.`
      );
      return { kind: "rate-limited" };
    }
    if (res.status === 404) {
      return { kind: "not-found", cached: false };
    }
    if (!res.ok) {
      console.warn(`[docta-client] GET ${path}: HTTP ${res.status}`);
      return { kind: "error" };
    }
    return { kind: "ok", data: (await res.json()) as T, cached: false };
  } catch (error) {
    console.warn(`[docta-client] GET ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return { kind: "error" };
  }
}

async function readCache(ticker: string): Promise<CachedDoctaPayload> {
  const row = await prisma.scrapedBondData.findUnique({ where: { ticker } });
  if (!row) return {};
  const payload = row.payload as unknown;
  if (payload && typeof payload === "object" && ("instrument" in payload || "cashflow" in payload)) {
    return payload as CachedDoctaPayload;
  }
  // A pre-existing row from a different source (e.g. the argen.bond scraper's
  // ScrapedBondProposal shape) — not a Docta cache hit, do not misread it.
  return {};
}

async function writeCache(ticker: string, patch: CachedDoctaPayload): Promise<void> {
  const existing = await readCache(ticker);
  const merged: CachedDoctaPayload = { ...existing, ...patch };
  await prisma.scrapedBondData.upsert({
    where: { ticker },
    create: {
      ticker,
      sourceUrl: `${BASE_URL}/bonds/instruments/${ticker}`,
      payload: merged,
    },
    update: { payload: merged },
  });
}

/**
 * True for a ticker whose Docta *instrument* lookup already has a permanent
 * answer (ok or confirmed 404) cached — i.e. a live call would be pointless.
 * Used by `fixed-income-linking.ts` to build `docta-linking-plan.ts`'s
 * `needsDoctaLookup` flag without spending a network call to find out.
 */
export async function hasResolvedDoctaInstrumentCache(tickers: string[]): Promise<Set<string>> {
  if (tickers.length === 0) return new Set();
  const rows = await prisma.scrapedBondData.findMany({
    where: { ticker: { in: tickers } },
    select: { ticker: true, payload: true },
  });
  const resolved = new Set<string>();
  for (const row of rows) {
    const payload = row.payload as unknown;
    if (payload && typeof payload === "object" && "instrument" in payload) {
      resolved.add(row.ticker);
    }
  }
  return resolved;
}

/** `GET /bonds/instruments/{TICKER}` — also the AD-13 ISIN linking key. A
 * cached `ok` or `not-found` is never re-fetched (see module docstring). */
export async function fetchDoctaInstrument(
  ticker: string
): Promise<DoctaLookupResult<DoctaInstrumentResponse>> {
  if (!isDoctaEnabled()) return { kind: "error" };

  const cached = await readCache(ticker);
  if ("instrument" in cached) {
    return cached.instrument === null
      ? { kind: "not-found", cached: true }
      : { kind: "ok", data: cached.instrument as DoctaInstrumentResponse, cached: true };
  }

  const result = await doctaGet<DoctaInstrumentResponse>(`/bonds/instruments/${ticker}`);
  if (result.kind === "rate-limited" || result.kind === "error") return result;

  try {
    await writeCache(ticker, { instrument: result.kind === "ok" ? result.data : null });
  } catch (error) {
    console.warn(`[docta-client] cache write failed for ${ticker}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}

/** `GET /bonds/analytics/{TICKER}/cashflow?nominal_units=100` — held
 * instruments only (never the whole universe). A cached `ok` or `not-found`
 * is never re-fetched. */
export async function fetchDoctaCashflow(
  ticker: string
): Promise<DoctaLookupResult<DoctaCashflowResponse>> {
  if (!isDoctaEnabled()) return { kind: "error" };

  const cached = await readCache(ticker);
  if ("cashflow" in cached) {
    return cached.cashflow === null
      ? { kind: "not-found", cached: true }
      : { kind: "ok", data: cached.cashflow as DoctaCashflowResponse, cached: true };
  }

  const result = await doctaGet<DoctaCashflowResponse>(
    `/bonds/analytics/${ticker}/cashflow?nominal_units=100`
  );
  if (result.kind === "rate-limited" || result.kind === "error") return result;

  try {
    await writeCache(ticker, { cashflow: result.kind === "ok" ? result.data : null });
  } catch (error) {
    console.warn(`[docta-client] cache write failed for ${ticker}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}
