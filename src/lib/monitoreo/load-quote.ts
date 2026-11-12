import { prisma } from "@/lib/prisma";
import { fetchLiveQuoteFromData912 } from "@/lib/market/data912-live";
import { DATA912_LIVE_SOURCE, resolveMonitoringRouting } from "@/lib/market/provider-routing";
import { fetchYahooQuote } from "@/lib/market/yahoo";
import { planQuoteAttempts } from "@/lib/monitoreo/quote-source";
import type { UiMonitoringSeriesKind } from "@/lib/monitoreo/types";

export type MarketQuote =
  | { price: number; currency: "ARS" | "USD"; source: string; asOf: string | null }
  | { price: null };

const UPSTREAM_TIMEOUT_MS = 5000;

/** Bounds a call that can't be aborted (Yahoo helper takes no signal): the loser is ignored. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("quote upstream timeout")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Read-only: never writes to PriceCache. Failures degrade to `{ price: null }`. */
export async function fetchMarketQuote(input: {
  instrumentId: string;
  kind: UiMonitoringSeriesKind;
}): Promise<MarketQuote | null> {
  let instrument;
  try {
    instrument = await prisma.instrument.findUnique({
      where: { id: input.instrumentId },
      include: { underlyingAsset: { select: { ticker: true } } },
    });
  } catch (error) {
    // A lookup failure degrades like a source failure; 404 stays for an unknown instrument.
    console.error("fetchMarketQuote instrument lookup failed:", error);
    return { price: null };
  }
  if (!instrument) return null;

  const routing = resolveMonitoringRouting(instrument, input.kind);
  const attempts = planQuoteAttempts(instrument, routing);

  for (const attempt of attempts) {
    try {
      if (attempt.provider === "data912") {
        const quote = await fetchLiveQuoteFromData912(attempt.ticker, attempt.type, {
          fresh: true,
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        if (quote) {
          return {
            price: quote.close,
            currency: routing.currency,
            source: DATA912_LIVE_SOURCE,
            asOf: new Date().toISOString(),
          };
        }
      } else {
        const quote = await withTimeout(
          fetchYahooQuote(attempt.symbol, { fresh: attempt.fresh }),
          UPSTREAM_TIMEOUT_MS
        );
        return {
          price: quote.price,
          currency: routing.currency,
          source: "yahoo",
          asOf: quote.asOf !== null ? new Date(quote.asOf * 1000).toISOString() : null,
        };
      }
    } catch {
      // try the next source
    }
  }
  return { price: null };
}
