/**
 * Instrument catalog sync — reconciles our Instrument table against the live
 * BYMA universe from data912.
 *
 * Idempotent by design (safe to re-run):
 *   - new symbol      → create (active = true)
 *   - existing symbol → keep, reactivate if it had been delisted
 *   - vanished symbol → active = false (SOFT delist; never delete — Transaction
 *                       rows FK Instrument and history must survive)
 *
 * Reconciliation is scoped to the catalog domain (venueCode = BYMA + the three
 * ingested types) so it never touches manual/foreign instruments.
 */

import { InstrumentType } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchInstrumentUniverse, type CatalogInstrument } from "./data912-universe";
import { CURATED_INSTRUMENT_NAMES, displayNameFor } from "./instrument-names";

const CATALOG_TYPES: InstrumentType[] = [
  InstrumentType.STOCK_AR,
  InstrumentType.CEDEAR,
  InstrumentType.ON,
  InstrumentType.STOCK_US
];

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

function identityKey(i: {
  ticker: string;
  type: InstrumentType;
  // currencyCode: string;
  // venueCode: string | null;
}): string {
  // return `${i.ticker}|${i.type}|${i.currencyCode}|${i.venueCode ?? ""}`;
  return `${i.ticker}|${i.type} ?? ""}`;
}

export type CatalogSyncResult = {
  ok: boolean;
  fetched: number;
  created: number;
  reactivated: number;
  delisted: number;
  renamed: number;
  error?: string;
};

export type TickerInfo = {
  ticker?: string;
  name?: string;
  country?: string;
  currency?: string;
  estimateCurrency?: string;
  exchange?: string;
  ipo?: string;
  marketCapitalization?: number;
  logo?: string;
  shareOutstanding?: number;
  finnhubIndustry?: string;
  phone?: string;
  weburl?: string;
  floatingShare?: number;
};

/**
 * Best-effort lookup of the display name from Finnhub. Never throws: if the
 * key is missing, the request fails, or Finnhub rate-limits us, we just fall
 * back to the curated/ticker name so a flaky third party can't block creates.
 */
async function lookupFinnhubData(ticker: string): Promise<TickerInfo | undefined> {
  if (!FINNHUB_API_KEY) return undefined;

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_API_KEY}`
    );
    if (!res.ok) return undefined;

    const tickerInfo: TickerInfo = await res.json();
    return tickerInfo;
  } catch {
    return undefined;
  }
}

export async function syncInstrumentCatalog(): Promise<CatalogSyncResult> {
  const universe = await fetchInstrumentUniverse();

  // Guard: an empty universe means every endpoint failed. Bailing out here is
  // what prevents a transient data912 outage from delisting the whole catalog.
  if (universe.length === 0) {
    return {
      ok: false,
      fetched: 0,
      created: 0,
      reactivated: 0,
      delisted: 0,
      renamed: 0,
      error: "Universo vacío — no se tocó el catálogo (probable caída de data912)",
    };
  }

  const wanted = new Map<string, CatalogInstrument>();
  for (const i of universe) wanted.set(identityKey(i), i);

  const existing = await prisma.instrument.findMany({
    where: { type: { in: CATALOG_TYPES } },
    select: { id: true, ticker: true, type: true, currencyCode: true, venueCode: true, active: true },
  });
  const existingByKey = new Map(existing.map((e) => [identityKey(e), e]));

  // --- Creates ---
  const toCreate = [...wanted.values()].filter((i) => !existingByKey.has(identityKey(i)));

  const getVenueCode = (i: CatalogInstrument,finnhubData: TickerInfo | undefined) => {
    if (finnhubData?.exchange?.includes("NASDAQ")) return "NASDAQ";
    if (finnhubData?.exchange?.includes("NEW YORK STOCK EXCHANGE")) return "NYSE";
    if (i.type === "STOCK_AR" || i.type === "ON" || i.type === "CEDEAR") return "BYMA";
    return null;
  };

  let created = 0;
  if (toCreate.length > 0) {
    // Resolve every Finnhub lookup FIRST, outside of the db call, so we hand
    // Prisma a plain array of ready values instead of unresolved Promises.
    const toCreateData = await Promise.all(
      toCreate.map(async (i) => {
        const finnhubData = await lookupFinnhubData(i.ticker);
        return {
          ticker: i.ticker,
          name: finnhubData?.name ?? displayNameFor(i.ticker),
          type: i.type,
          venueCode: getVenueCode(i, finnhubData),
          currencyCode: finnhubData?.currency ?? i.type === "STOCK_US" ? "USD" : "ARS",
          taxJurisdiction: i.type === "STOCK_US" || i.type === "CEDEAR"  ? "USD" : "ARS",
          active: true,
        };
      })
    );

    const res = await prisma.instrument.createMany({
      data: toCreateData,
      skipDuplicates: true,
    });
    created = res.count;
  }

  // --- Reactivations (previously soft-delisted, now listed again) ---
  const toReactivate = existing
    .filter((e) => !e.active && wanted.has(identityKey(e)))
    .map((e) => e.id);
  let reactivated = 0;
  if (toReactivate.length > 0) {
    const res = await prisma.instrument.updateMany({
      where: { id: { in: toReactivate } },
      data: { active: true },
    });
    reactivated = res.count;
  }

  // --- Soft delists (listed before, gone now) ---
  const toDelist = existing
    .filter((e) => e.active && !wanted.has(identityKey(e)))
    .map((e) => e.id);
  let delisted = 0;
  if (toDelist.length > 0) {
    const res = await prisma.instrument.updateMany({
      where: { id: { in: toDelist } },
      data: { active: false },
    });
    delisted = res.count;
  }

  // --- Name enrichment: backfill curated names onto rows still named as their
  // ticker. Bounded by the curated map (~dozens), one update per entry. ---
  let renamed = 0;
  for (const [ticker, name] of Object.entries(CURATED_INSTRUMENT_NAMES)) {
    const res = await prisma.instrument.updateMany({
      where: { ticker, type: { in: CATALOG_TYPES }, venueCode: "BYMA", name: ticker },
      data: { name },
    });
    renamed += res.count;
  }

  return {
    ok: true,
    fetched: universe.length,
    created,
    reactivated,
    delisted,
    renamed,
  };
}