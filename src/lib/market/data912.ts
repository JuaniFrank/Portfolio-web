/**
 * Client for data912.com — BYMA corporate bond (ON) live prices.
 *
 * Endpoint: https://data912.com/live/arg_corp
 *
 * The `c` field in each quote is ARS per 100 nominal VN (face value):
 *   position value ARS = nominalHeld × c / 100
 *   (`c` is quoted per 100 VN; nominalHeld is a raw VN count, so divide by 100.
 *    See valuation.ts VN_QUOTE_BASIS.)
 *
 * Caching strategy mirrors quotes.ts:
 *   - Next.js fetch cache: revalidate=300s, tag "on-prices"
 *   - PriceCache upsert on success (source = "data912")
 *   - On fetch failure: fall back to most recent PriceCache per symbol, stale=true
 *   - Missing symbols (no live price AND no cache) are omitted from the result map
 */

import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";

const DATA912_ENDPOINT = "https://data912.com/live/arg_corp";
const REVALIDATE_SECONDS = 300;

export type Data912Quote = {
  symbol: string;
  /** Last price: ARS per 100 nominal VN. */
  c: number;
  px_bid: number;
  px_ask: number;
  pct_change: number;
};

type Data912RawItem = {
  symbol?: unknown;
  c?: unknown;
  px_bid?: unknown;
  px_ask?: unknown;
  pct_change?: unknown;
  [key: string]: unknown;
};

export type FetchOnPricesResult = {
  quotes: Map<string, Data912Quote>;
  stale: boolean;
};

/**
 * Fetch ON prices for the given tickers from data912.com.
 *
 * Returns a map keyed by ticker (uppercase). On live-fetch failure the map
 * contains the most recent PriceCache entries and stale=true. Symbols with
 * no live price and no cache are omitted from the map.
 */
export async function fetchOnPrices(symbols: string[]): Promise<FetchOnPricesResult> {
  if (symbols.length === 0) {
    return { quotes: new Map(), stale: false };
  }

  const upperSymbols = symbols.map((s) => s.toUpperCase());

  // Attempt live fetch
  let rawItems: Data912RawItem[] | null = null;
  try {
    const res = await fetch(DATA912_ENDPOINT, {
      next: { revalidate: REVALIDATE_SECONDS, tags: ["on-prices"] },
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      rawItems = (await res.json()) as Data912RawItem[];
    }
  } catch {
    // Network error — fall through to cache path
  }

  if (rawItems !== null) {
    // Build lookup from the live response
    const liveMap = new Map<string, Data912RawItem>();
    for (const item of rawItems) {
      if (typeof item.symbol === "string" && item.symbol) {
        liveMap.set(item.symbol.toUpperCase(), item);
      }
    }

    // Truncate timestamp to the revalidation window so the upsert WHERE clause
    // matches a stable key. Without truncation, each call uses a brand-new
    // Date() and the update branch never fires — the table grows unbounded.
    // data912 provides no exchange timestamp, so we floor to the nearest 300s bucket.
    const nowMs = Date.now();
    const bucketMs = REVALIDATE_SECONDS * 1000;
    const bucketedNow = new Date(Math.floor(nowMs / bucketMs) * bucketMs);

    const quotes = new Map<string, Data912Quote>();

    await Promise.all(
      upperSymbols.map(async (ticker) => {
        const item = liveMap.get(ticker);
        if (!item || typeof item.c !== "number" || !Number.isFinite(item.c)) return;

        const quote: Data912Quote = {
          symbol: ticker,
          c: item.c,
          px_bid: typeof item.px_bid === "number" ? item.px_bid : item.c,
          px_ask: typeof item.px_ask === "number" ? item.px_ask : item.c,
          pct_change: typeof item.pct_change === "number" ? item.pct_change : 0,
        };

        quotes.set(ticker, quote);

        // Persist to PriceCache — non-fatal on error
        try {
          const instrument = await prisma.instrument.findFirst({
            where: { ticker, type: "ON" },
            select: { id: true },
          });
          if (instrument) {
            await prisma.priceCache.upsert({
              where: {
                instrumentId_datetime_source: {
                  instrumentId: instrument.id,
                  datetime: bucketedNow,
                  source: "data912",
                },
              },
              create: {
                instrumentId: instrument.id,
                datetime: bucketedNow,
                close: new Prisma.Decimal(item.c),
                source: "data912",
              },
              update: {
                close: new Prisma.Decimal(item.c),
              },
            });
          }
        } catch {
          // PriceCache write failure is non-fatal
        }
      })
    );

    return { quotes, stale: false };
  }

  // Live fetch failed — fall back to PriceCache
  const staleQuotes = await readCachedQuotes(upperSymbols);
  return { quotes: staleQuotes, stale: true };
}

/**
 * Read the most recent PriceCache entries for the given symbols.
 * Stale entries (any age) are included — the caller already signals stale=true.
 */
async function readCachedQuotes(symbols: string[]): Promise<Map<string, Data912Quote>> {
  const quotes = new Map<string, Data912Quote>();

  await Promise.all(
    symbols.map(async (ticker) => {
      try {
        const instrument = await prisma.instrument.findFirst({
          where: { ticker, type: "ON" },
          select: { id: true },
        });
        if (!instrument) return;

        const cached = await prisma.priceCache.findFirst({
          where: { instrumentId: instrument.id, source: "data912" },
          orderBy: { datetime: "desc" },
          select: { close: true },
        });
        if (!cached) return;

        const price = Number(cached.close.toString());
        if (!Number.isFinite(price)) return;

        quotes.set(ticker, {
          symbol: ticker,
          c: price,
          px_bid: price,
          px_ask: price,
          pct_change: 0,
        });
      } catch {
        // Read failure for this symbol — omit it from the map
      }
    })
  );

  return quotes;
}
