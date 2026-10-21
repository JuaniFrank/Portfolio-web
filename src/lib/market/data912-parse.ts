/**
 * Pure parsing of data912 ON quotes. A `c` of 0 (or negative / non-finite) is data912's
 * way of saying "no trade/no data", never a price: accepting it values the position at 0
 * and persists a -100% P&L.
 */

import type { Data912Quote } from "./data912";

type RawQuoteFields = {
  c?: unknown;
  px_bid?: unknown;
  px_ask?: unknown;
  pct_change?: unknown;
};

function isPositivePrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Quote for `ticker` from a raw data912 item, or null when it carries no usable price. */
export function parseLiveOnQuote(
  item: RawQuoteFields | undefined,
  ticker: string
): Data912Quote | null {
  if (!item || !isPositivePrice(item.c)) return null;
  return {
    symbol: ticker,
    c: item.c,
    px_bid: typeof item.px_bid === "number" ? item.px_bid : item.c,
    px_ask: typeof item.px_ask === "number" ? item.px_ask : item.c,
    pct_change: typeof item.pct_change === "number" ? item.pct_change : 0,
  };
}

/** A cached close is only usable when it is a positive finite number. */
export function parseCachedClose(close: number): number | null {
  return isPositivePrice(close) ? close : null;
}
