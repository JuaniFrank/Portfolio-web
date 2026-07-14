/**
 * Adapta posiciones ON (valuación data912) al formato de Dashboard y Transacciones.
 */

import Decimal from "decimal.js";
import type { HoldingForDashboard } from "@/lib/dashboard/build";
import type { FetchOnPricesResult } from "@/lib/market/data912";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import type { HoldingRow } from "@/lib/transactions/types";
import { buildBondHoldings, type TradeForBondHoldings } from "./holdings";
import { markToMarket } from "./valuation";

export type ValuatedOnPosition = {
  instrumentId: string;
  ticker: string;
  instrumentName: string;
  nominalHeld: string;
  costBasisUsd: string;
  marketValueArs: string;
  marketValueUsd: string | null;
  pnlArs: string;
  pnlPercent: string;
};

export function toBondTrade(t: TradeForHoldings, currencyCode: string): TradeForBondHoldings {
  return {
    instrumentId: t.instrumentId,
    ticker: t.ticker,
    type: t.type,
    quantity: t.quantity,
    netAmount: t.netAmount,
    currencyCode,
    tradeDate: t.tradeDate,
  };
}

export function valuateOnPositions(
  trades: TradeForBondHoldings[],
  priceResult: FetchOnPricesResult,
  cclRate: number | null,
  namesById: Map<string, string>
): ValuatedOnPosition[] {
  const buySell = trades.filter((t) => t.type === "BUY" || t.type === "SELL");
  const raw = buildBondHoldings(buySell);

  return raw.map((h) => {
    const quote = priceResult.quotes.get(h.ticker.toUpperCase()) ?? null;
    const isStale = priceResult.stale && quote !== null;
    const mtm = markToMarket(h, quote, cclRate, isStale);
    const marketValueArs = mtm.marketValueArs ?? "0";
    const costBasisArs =
      cclRate && cclRate > 0
        ? new Decimal(h.costBasisUsd).mul(cclRate)
        : new Decimal(0);
    const pnlArs = new Decimal(marketValueArs).minus(costBasisArs);
    const pnlPercent = costBasisArs.isZero()
      ? new Decimal(0)
      : pnlArs.div(costBasisArs).mul(100);

    return {
      instrumentId: h.instrumentId,
      ticker: h.ticker,
      instrumentName: namesById.get(h.instrumentId) ?? h.ticker,
      nominalHeld: h.nominalHeld,
      costBasisUsd: h.costBasisUsd,
      marketValueArs,
      marketValueUsd: mtm.marketValueUsd,
      pnlArs: pnlArs.toFixed(2),
      pnlPercent: pnlPercent.toFixed(2),
    };
  });
}

export function toHoldingRow(p: ValuatedOnPosition, cclRate: number | null): HoldingRow {
  const nominal = new Decimal(p.nominalHeld);
  const costBasisArs =
    cclRate && cclRate > 0
      ? new Decimal(p.costBasisUsd).mul(cclRate).toFixed(2)
      : "0";
  const marketValue = new Decimal(p.marketValueArs);
  const avgPriceArs = nominal.isZero()
    ? "0"
    : new Decimal(costBasisArs).div(nominal).toFixed(2);
  const currentPriceArs = nominal.isZero() ? "0" : marketValue.div(nominal).toFixed(2);

  return {
    instrumentId: p.instrumentId,
    ticker: p.ticker,
    instrumentType: "ON",
    instrumentName: p.instrumentName,
    quantity: p.nominalHeld,
    avgPriceArs,
    costBasisArs,
    currentPriceArs,
    marketValueArs: p.marketValueArs,
    pnlArs: p.pnlArs,
    pnlPercent: p.pnlPercent,
  };
}

export function toDashboardHolding(p: ValuatedOnPosition, cclRate: number | null): HoldingForDashboard {
  const costBasisArs =
    cclRate && cclRate > 0
      ? new Decimal(p.costBasisUsd).mul(cclRate).toFixed(2)
      : "0";

  return {
    instrumentId: p.instrumentId,
    ticker: p.ticker,
    instrumentName: p.instrumentName,
    instrumentType: "ON",
    quantity: p.nominalHeld,
    costBasisArs,
    marketValueArs: p.marketValueArs,
    pnlArs: p.pnlArs,
    pnlPercent: p.pnlPercent,
    sector: null,
  };
}
