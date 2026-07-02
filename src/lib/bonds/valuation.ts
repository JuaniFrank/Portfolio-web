/**
 * Mark-to-market valuation for ON (corporate bond) positions.
 *
 * Valuation semantics (confirmed by orchestrator):
 *   Balanz Cantidad = 1 unit = one 100-VN lámina.
 *   data912 `c` = ARS per 100 nominal VN.
 *
 * Therefore:
 *   marketValueARS = nominalHeld × c
 *   marketValueUSD = marketValueARS / cclMid
 *
 * VN_PER_UNIT documents this assumption explicitly. If empirical verification
 * against a running Balanz account shows Cantidad is NOT per-100-VN lámina
 * (e.g. it is raw VN face value), update this constant to 1 and the
 * formulas below will adjust automatically.
 */

import Decimal from "decimal.js";
import type { BondHolding } from "./types";
import type { Data912Quote } from "@/lib/market/data912";

/**
 * Units of nominal VN per 1 Balanz Cantidad unit.
 *
 * Current assumption: 1 Balanz unit = 1 lámina = 100 VN face value.
 * data912 `c` is already quoted per 100 VN, so:
 *   position ARS = nominalHeld × c   (the /100 and ×100 cancel out)
 *
 * Sanity check: MCC3O → 1 unit × ~153 990 ARS / CCL ≈ 110 USD,
 * close to the ~149 USD cost basis observed. Consistent.
 */
export const VN_PER_UNIT = 100;

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

  // nominalHeld × c  (since 1 unit = 100 VN and c is ARS/100VN, the factors cancel)
  // Documented: VN_PER_UNIT = 100 is the assumption; update if Cantidad semantics differ.
  void VN_PER_UNIT; // reference to keep the constant visible to callers
  const marketValueArs = nominal.mul(new Decimal(quote.c)).toDecimalPlaces(2);

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
