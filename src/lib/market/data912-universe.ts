/**
 * data912.com universe reader — the list of instruments currently listed on
 * BYMA, used to feed our searchable instrument catalog.
 *
 * Unlike the price path (data912.ts), this cares only about WHICH symbols
 * exist and how to classify them — not their prices. data912's payload has no
 * names, so names are enriched separately from a curated map.
 *
 * Endpoints are deliberately limited to the five BYMA universes supported by
 * this version. `usa_stocks` remains excluded, but the endpoint configuration
 * keeps type and origin separate so it can be reintroduced later.
 *
 * AD-10: one reader (`fetchData912Live`), two cache policies, ONE payload
 * shape rich enough for both consumers — the settlement-matching ratio
 * refinement (§4) needs `price`; the market-snapshot upsert needs the full
 * quote (bid/ask/volume/etc). `catalog-sync.ts`'s pipeline (§5.1) fetches
 * once with `cache: "no-store"` and threads the same rows through both the
 * snapshot upsert and the linking step — a second price fetch inside the
 * sync would double data912 load for data already in hand.
 */

import { InstrumentType } from "@/lib/generated/prisma";

const BASE = "https://data912.com/live";
// Catalog changes slowly; a 1h fetch cache keeps the self-heal path cheap
// without pinning stale data for long.
const REVALIDATE_SECONDS = 60 * 60 * 1;

type Data912UniverseItem = { symbol?: unknown; [key: string]: unknown };

export type CatalogInstrument = {
  ticker: string;
  type: InstrumentType;
  /** data912 `c` (last price). Feeds the settlement-matching ratio
   * refinement (§4) and `MarketSnapshot.price`. null when unreported. */
  price: number | null;
  pctChange: number | null;
  volume: number | null;
  bidQuantity: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  askQuantity: number | null;
  openInterest: number | null;
};

export const DATA912_CATALOG_ENDPOINTS: ReadonlyArray<{ path: string; type: InstrumentType }> = [
  { path: "arg_stocks", type: InstrumentType.STOCK_AR },
  { path: "arg_cedears", type: InstrumentType.CEDEAR },
  { path: "arg_corp", type: InstrumentType.ON },
  { path: "arg_bonds", type: InstrumentType.BOND_AR },
  { path: "arg_notes", type: InstrumentType.LETRA },
  // { path: "usa_stocks", type: InstrumentType.STOCK_US },
];

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Single reader for the five data912 catalog endpoints, parameterized by
 * cache policy (AD-10). Pass `revalidateSeconds` for the cached, catalog-
 * tagged read (`fetchInstrumentUniverse`); omit it for an uncached,
 * always-fresh read (the sync pipeline, §5.1 step 1).
 */
export async function fetchData912Live(options: {
  revalidateSeconds?: number;
}): Promise<CatalogInstrument[]> {
  const results = await Promise.allSettled(
    DATA912_CATALOG_ENDPOINTS.map(async ({ path, type }) => {
      const fetchInit: RequestInit & { next?: NextFetchRequestConfig } =
        options.revalidateSeconds !== undefined
          ? {
              next: { revalidate: options.revalidateSeconds, tags: ["instrument-catalog"] },
              headers: { Accept: "application/json" },
            }
          : { cache: "no-store", headers: { Accept: "application/json" } };

      const res = await fetch(`${BASE}/${path}`, fetchInit);
      if (!res.ok) throw new Error(`data912 ${path}: HTTP ${res.status}`);

      const raw = (await res.json()) as Data912UniverseItem[];
      if (!Array.isArray(raw)) throw new Error(`data912 ${path}: formato inválido`);

      const seen = new Map<string, CatalogInstrument>();
      for (const item of raw) {
        if (typeof item.symbol !== "string" || !item.symbol.trim()) continue;
        const ticker = item.symbol.trim().toUpperCase();
        if (seen.has(ticker)) continue; // first occurrence wins, harmless dedupe
        seen.set(ticker, {
          ticker,
          type,
          price: numberOrNull(item.c),
          pctChange: numberOrNull(item.pct_change),
          volume: numberOrNull(item.v),
          bidQuantity: numberOrNull(item.q_bid),
          bidPrice: numberOrNull(item.px_bid),
          askPrice: numberOrNull(item.px_ask),
          askQuantity: numberOrNull(item.q_ask),
          openInterest: numberOrNull(item.q_op),
        });
      }
      return [...seen.values()];
    })
  );

  const out: CatalogInstrument[] = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
      out.push(...r.value);
    } else {
      console.error(`fetchData912Live:${DATA912_CATALOG_ENDPOINTS[i]!.path}`, r.reason);
    }
  }
  return out;
}

/** Catalog-tagged, cached read — used by the self-heal search path and the
 * catalog reconciliation step. `revalidate: 3600`, tag `instrument-catalog`. */
export async function fetchInstrumentUniverse(): Promise<CatalogInstrument[]> {
  return fetchData912Live({ revalidateSeconds: REVALIDATE_SECONDS });
}
