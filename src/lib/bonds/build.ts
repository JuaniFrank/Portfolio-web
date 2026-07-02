/**
 * Pure assembly function: combines holdings, market prices, CCL, and cash flows
 * into a fully typed BondsPageData struct.
 *
 * No I/O — pure composition of domain functions.
 */

import Decimal from "decimal.js";
import type { BondsPageData, BondHolding, BondKpis } from "./types";
import { buildBondHoldings, type TradeForBondHoldings } from "./holdings";
import { markToMarket } from "./valuation";
import { aggregateReceivedFlows, computeCouponsYtd, type TransactionForCashFlows } from "./cashflows";
import type { FetchOnPricesResult } from "@/lib/market/data912";

export type TradeForBonds = TradeForBondHoldings & TransactionForCashFlows;

/**
 * Assemble the full BondsPageData from raw inputs.
 *
 * @param trades     - All ON transactions (BUY, SELL, COUPON, AMORTIZATION)
 * @param priceResult - Result from fetchOnPrices()
 * @param cclMid     - CCL mid rate from fetchCclQuote(); null if unavailable
 */
export function buildBondsPageData(
  trades: TradeForBonds[],
  priceResult: FetchOnPricesResult,
  cclMid: number | null
): BondsPageData {
  // Build raw holdings (nominal + cost basis only, no valuation yet)
  const rawHoldings = buildBondHoldings(
    trades.filter((t) => t.type === "BUY" || t.type === "SELL")
  );

  // Apply mark-to-market valuation to each holding
  const holdings: BondHolding[] = rawHoldings.map((holding) => {
    const quote = priceResult.quotes.get(holding.ticker.toUpperCase()) ?? null;
    const isStale = priceResult.stale && quote !== null;
    const mtm = markToMarket(holding, quote, cclMid, isStale);
    return { ...holding, ...mtm };
  });

  // Cash flows (COUPON + AMORTIZATION)
  const flows = aggregateReceivedFlows(trades);

  // KPIs
  const couponsYtdUsd = computeCouponsYtd(flows, cclMid ?? 0);

  let totalMarketValueUsdDecimal: Decimal | null = null;
  let totalMarketValueArsDecimal: Decimal | null = null;

  for (const h of holdings) {
    if (h.marketValueUsd !== null) {
      totalMarketValueUsdDecimal = (totalMarketValueUsdDecimal ?? new Decimal(0)).plus(
        new Decimal(h.marketValueUsd)
      );
    }
    if (h.marketValueArs !== null) {
      totalMarketValueArsDecimal = (totalMarketValueArsDecimal ?? new Decimal(0)).plus(
        new Decimal(h.marketValueArs)
      );
    }
  }

  const kpis: BondKpis = {
    totalMarketValueUsd: totalMarketValueUsdDecimal?.toFixed(2) ?? null,
    totalMarketValueArs: totalMarketValueArsDecimal?.toFixed(2) ?? null,
    couponsYtdUsd,
  };

  const anyPriceStale = priceResult.stale && priceResult.quotes.size > 0;

  return {
    holdings,
    flows,
    kpis,
    cclMid: cclMid !== null ? cclMid.toFixed(2) : null,
    anyPriceStale,
  };
}
