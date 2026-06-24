import Decimal from "decimal.js";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import type { CorporateEventForBuilder } from "./types";

/**
 * Apply a sorted list of corporate events to a single trade.
 *
 * Rules (per spec FR-5, FR-10, FR-11):
 * - Events MUST be pre-sorted ascending by effectiveDate (caller responsibility).
 * - Pre-event condition: tradeDate < effectiveDate (lexical YYYY-MM-DD comparison).
 * - Post-event trades (tradeDate >= effectiveDate) are NOT adjusted.
 * - TICKER_CHANGE is a no-op — no quantity or price adjustment.
 * - netAmount is INVARIANT — only quantity and price are mutated.
 */
export function applyEventsToTrade(
  trade: TradeForHoldings,
  events: CorporateEventForBuilder[]
): TradeForHoldings {
  // tradeDate comes as ISO string; take the date prefix for lexical comparison
  const tradeDay = trade.tradeDate.slice(0, 10);

  let quantity = new Decimal(trade.quantity);
  let price = new Decimal(trade.price);

  for (const event of events) {
    // Only adjust pre-event trades
    if (tradeDay >= event.effectiveDate) continue;

    // TICKER_CHANGE is recorded but applies no math
    if (event.eventType === "TICKER_CHANGE") continue;

    const ratio = new Decimal(event.numerator).div(new Decimal(event.denominator));
    quantity = quantity.mul(ratio);
    price = price.div(ratio);
  }

  return {
    ...trade,
    quantity: quantity.toString(),
    price: price.toString(),
    // netAmount is intentionally unchanged
  };
}
