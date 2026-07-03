/**
 * Mark-to-market valuation for ON (corporate bond) positions.
 *
 * Valuation semantics (verified against a real Balanz position + live data912):
 *   Balanz Cantidad = raw VN face value held (e.g. 149 = 149 nominal VN).
 *   data912 `c`     = ARS per 100 nominal VN.
 *
 * Therefore:
 *   marketValueARS = nominalHeld × c / 100
 *   marketValueUSD = marketValueARS / cclMid
 *
 * The /100 is essential: `c` is quoted per 100 VN, but Cantidad is a raw VN
 * count, NOT a count of 100-VN láminas. Omitting it inflates the position by
 * exactly 100× (the bug that reported MCC3O at ~US$14.7k instead of ~US$147).
 *
 * Worked example (MCC3O): 149 VN × 155 000 / 100 / CCL(≈1575)
 *   = 149 × 1 550 / 1575 ≈ US$146.6, consistent with the ~US$149 cost basis.
 */

import Decimal from "decimal.js";
import type { BondHolding } from "./types";
import type { Data912Quote } from "@/lib/market/data912";

/**
 * Nominal VN that data912's `c` price is quoted against.
 *
 * data912 reports `c` as ARS per 100 VN, while Balanz Cantidad (nominalHeld)
 * is a raw VN count, so per-VN price = c / VN_QUOTE_BASIS.
 */
export const VN_QUOTE_BASIS = 100;

export type MarkToMarketResult = {
  marketValueArs: string | null;
  marketValueUsd: string | null;
  unrealizedPnlUsd: string | null;
  pctChange: string | null;
  priceStale: boolean;
  priceUnavailable: boolean;
  /** ARS per 100 nominal VN from data912 `c` field. Null when price unavailable. */
  lastPriceArs: string | null;
};

/**
 * Compute mark-to-market valuation for a single bond position.
 *
 * States:
 *   - Live:      quote != null, cclMid != null → all fields populated, stale=false
 *   - Degraded:  quote from stale cache (caller sets priceStale=true on the holding
 *                and passes the same quote object) → fields populated, stale=true
 *   - No price:  quote == null → marketValue* = null, priceUnavailable=true
 *   - No CCL:    cclMid == null → marketValueArs populated, marketValueUsd = null
 */
export function markToMarket(
  holding: BondHolding,
  quote: Data912Quote | null,
  cclMid: number | null,
  priceStale: boolean
): MarkToMarketResult {
  if (!quote) {
    return {
      marketValueArs: null,
      marketValueUsd: null,
      unrealizedPnlUsd: null,
      pctChange: null,
      priceStale: false,
      priceUnavailable: true,
      lastPriceArs: null,
    };
  }

  const nominal = new Decimal(holding.nominalHeld);

  // marketValueARS = nominalHeld (raw VN) × c (ARS per 100 VN) / 100.
  // The /VN_QUOTE_BASIS converts the per-100-VN quote to a per-VN price.
  const marketValueArs = nominal
    .mul(new Decimal(quote.c))
    .div(VN_QUOTE_BASIS)
    .toDecimalPlaces(2);

  let marketValueUsd: Decimal | null = null;
  if (cclMid !== null && cclMid > 0) {
    marketValueUsd = marketValueArs.div(new Decimal(cclMid)).toDecimalPlaces(2);
  }

  let unrealizedPnlUsd: Decimal | null = null;
  let pctChange: Decimal | null = null;

  if (marketValueUsd !== null) {
    const costBasis = new Decimal(holding.costBasisUsd);
    unrealizedPnlUsd = marketValueUsd.minus(costBasis).toDecimalPlaces(2);
    if (!costBasis.isZero()) {
      pctChange = unrealizedPnlUsd.div(costBasis).mul(100).toDecimalPlaces(2);
    }
  }

  return {
    marketValueArs: marketValueArs.toFixed(2),
    marketValueUsd: marketValueUsd?.toFixed(2) ?? null,
    unrealizedPnlUsd: unrealizedPnlUsd?.toFixed(2) ?? null,
    pctChange: pctChange?.toFixed(2) ?? null,
    priceStale,
    priceUnavailable: false,
    lastPriceArs: new Decimal(quote.c).toFixed(2),
  };
}
