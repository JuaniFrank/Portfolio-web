/**
 * Pure functions for ON (corporate bond) position aggregation.
 *
 * Scoped exclusively to instrumentType = "ON".
 * Does NOT touch TRADE_INSTRUMENT_TYPES or any other instrument domain.
 */

import Decimal from "decimal.js";
import type { BondHolding } from "./types";

export type TradeForBondHoldings = {
  instrumentId: string;
  ticker: string;
  /**
   * Transaction type as a string. Widened from "BUY"|"SELL" to accommodate the
   * full set of ON transaction types (COUPON, AMORTIZATION) that share the same
   * TradeForBonds intersection in build.ts.
   * buildBondHoldings filters internally to only process BUY and SELL rows.
   */
  type: string;
  /** Nominal units (Balanz Cantidad: 1 unit = one 100-VN lámina). */
  quantity: string;
  /** Net amount in native transaction currency (USD for ONs). */
  netAmount: string;
  /** Trade currency — expected to be "USD" for ONs. */
  currencyCode: string;
  tradeDate: string;
};

type PositionAgg = {
  instrumentId: string;
  ticker: string;
  nominalHeld: Decimal;
  costBasisUsd: Decimal;
};

/**
 * Compute net nominal holdings and USD cost basis from a list of ON trades.
 *
 * Groups by ticker (case-insensitive). Only positions with nominalHeld > 0
 * are returned (closed-out positions are excluded).
 *
 * Cost basis: sum of |netAmount| of BUY transactions in native currency (USD).
 * On SELL, cost basis is reduced proportionally (same AVCO logic as holdings.ts).
 */
export function buildBondHoldings(trades: TradeForBondHoldings[]): BondHolding[] {
  // Group by ticker
  const byTicker = new Map<string, TradeForBondHoldings[]>();
  for (const t of trades) {
    const key = t.ticker.toUpperCase();
    const list = byTicker.get(key) ?? [];
    list.push(t);
    byTicker.set(key, list);
  }

  const results: BondHolding[] = [];

  for (const [, tickerTrades] of byTicker) {
    const agg = computePosition(tickerTrades);
    if (agg.nominalHeld.lte(0)) continue; // fully sold or zero

    results.push({
      ticker: agg.ticker,
      instrumentId: agg.instrumentId,
      nominalHeld: agg.nominalHeld.toFixed(4).replace(/\.?0+$/, "") || "0",
      costBasisUsd: agg.costBasisUsd.toFixed(2),
      // Valuation fields are populated by markToMarket (valuation.ts)
      marketValueArs: null,
      marketValueUsd: null,
      unrealizedPnlUsd: null,
      pctChange: null,
      priceStale: false,
      priceUnavailable: true,
      lastPriceArs: null,
    });
  }

  return results;
}

function computePosition(trades: TradeForBondHoldings[]): PositionAgg {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
  );

  // Use the most recent instrumentId encountered (they should all be the same)
  let instrumentId = sorted[0]?.instrumentId ?? "";
  const ticker = sorted[0]?.ticker ?? "";

  let nominalHeld = new Decimal(0);
  let costBasisUsd = new Decimal(0);

  for (const t of sorted) {
    if (t.instrumentId) instrumentId = t.instrumentId;
    const qty = new Decimal(t.quantity).abs();
    const net = new Decimal(t.netAmount).abs();

    if (t.type === "BUY") {
      nominalHeld = nominalHeld.plus(qty);
      costBasisUsd = costBasisUsd.plus(net);
    } else {
      // SELL: reduce cost basis proportionally
      if (!nominalHeld.isZero()) {
        const costRemoved = costBasisUsd.mul(qty.div(nominalHeld));
        costBasisUsd = costBasisUsd.minus(costRemoved);
      }
      nominalHeld = nominalHeld.minus(qty);
      if (nominalHeld.lt(0)) nominalHeld = new Decimal(0);
      if (costBasisUsd.lt(0)) costBasisUsd = new Decimal(0);
    }
  }

  return { instrumentId, ticker, nominalHeld, costBasisUsd };
}
