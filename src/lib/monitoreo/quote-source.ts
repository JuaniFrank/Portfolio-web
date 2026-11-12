import type { InstrumentType } from "@/lib/generated/prisma";
import type { ProviderResolution } from "@/lib/market/provider-routing";

export type QuoteAttempt =
  | { provider: "data912"; ticker: string; type: InstrumentType }
  | { provider: "yahoo"; symbol: string; fresh: true };

/**
 * Ordered live-quote attempts for the series the user is looking at. The price must land in the
 * chart's scale: ARS kinds use the local BYMA quote, USD kinds the routed foreign symbol.
 * An empty plan means "no live source" and the caller falls back to the last close.
 */
export function planQuoteAttempts(
  instrument: { ticker: string; type: InstrumentType },
  routing: Pick<ProviderResolution, "provider" | "externalSymbol" | "currency">
): QuoteAttempt[] {
  if (routing.provider === "derived") return [];

  if (routing.currency === "USD") {
    // The series may be routed to FMP, but the quote always comes from Yahoo.
    return [{ provider: "yahoo", symbol: routing.externalSymbol, fresh: true }];
  }

  if (instrument.type !== "STOCK_AR" && instrument.type !== "CEDEAR") return [];
  return [
    { provider: "data912", ticker: instrument.ticker, type: instrument.type },
    { provider: "yahoo", symbol: `${instrument.ticker}.BA`, fresh: true },
  ];
}
