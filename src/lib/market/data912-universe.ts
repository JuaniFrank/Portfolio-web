/**
 * data912.com universe reader — the list of instruments currently listed on
 * BYMA, used to feed our searchable instrument catalog.
 *
 * Unlike the price path (data912.ts), this cares only about WHICH symbols
 * exist and how to classify them — not their prices. data912's payload has no
 * names, so names are enriched separately from a curated map.
 *
 * Endpoints (no auth):
 *   /live/arg_stocks  → STOCK_AR   (~97)
 *   /live/arg_cedears → CEDEAR     (~925, incl. IBIT, SPY, QQQ…)
 *   /live/arg_corp    → ON         (~590)
 *
 * We ingest only the three types the transactions page can display
 * (TRADE_INSTRUMENT_TYPES). Bonds/letras are intentionally skipped.
 */

import { InstrumentType } from "@/lib/generated/prisma";

const BASE = "https://data912.com/live";
// Catalog changes slowly; a 6h fetch cache keeps the self-heal path cheap
// without pinning stale data for long.
const REVALIDATE_SECONDS = 60 * 60 * 6;

type Data912UniverseItem = { symbol?: unknown; [key: string]: unknown };

export type CatalogInstrument = {
  ticker: string;
  type: InstrumentType;
  currencyCode: string;
  venueCode: string;
};

const ENDPOINTS: { path: string; type: InstrumentType }[] = [
  { path: "arg_stocks", type: InstrumentType.STOCK_AR },
  { path: "arg_cedears", type: InstrumentType.CEDEAR },
  { path: "arg_corp", type: InstrumentType.ON },
];

/**
 * Drop MEP (`…D`) and CCL (`…C`) settlement variants when their peso base
 * ticker is also present in the same list — e.g. keep AAPL, drop AAPLD/AAPLC.
 * Genuine tickers ending in C/D with no base (rare) are preserved.
 */
function stripCurrencyVariants(symbols: string[]): string[] {
  const set = new Set(symbols);
  return symbols.filter((s) => {
    const last = s.at(-1);
    if (last !== "C" && last !== "D") return true;
    return !set.has(s.slice(0, -1));
  });
}

async function fetchEndpointSymbols(path: string): Promise<string[]> {
  const res = await fetch(`${BASE}/${path}`, {
    next: { revalidate: REVALIDATE_SECONDS, tags: ["instrument-catalog"] },
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`data912 ${path}: HTTP ${res.status}`);

  const raw = (await res.json()) as Data912UniverseItem[];
  const symbols = raw
    .map((i) => (typeof i.symbol === "string" ? i.symbol.trim().toUpperCase() : ""))
    .filter(Boolean);

  return stripCurrencyVariants([...new Set(symbols)]);
}

/**
 * Fetch the full listed universe across the ingested endpoints. Endpoints are
 * fetched independently; a single failing endpoint is skipped (logged) rather
 * than sinking the whole sync.
 */
export async function fetchInstrumentUniverse(): Promise<CatalogInstrument[]> {
  const results = await Promise.allSettled(
    ENDPOINTS.map(async ({ path, type }) => {
      const symbols = await fetchEndpointSymbols(path);
      return symbols.map<CatalogInstrument>((ticker) => ({
        ticker,
        type,
        currencyCode: "ARS",
        venueCode: "BYMA",
      }));
    })
  );

  const out: CatalogInstrument[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
      out.push(...r.value);
    } else {
      console.error(`fetchInstrumentUniverse:${ENDPOINTS[i]!.path}`, r.reason);
    }
  }
  return out;
}
