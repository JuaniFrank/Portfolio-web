/**
 * Adapta posiciones ON (valuación data912) al formato de Dashboard y Transacciones.
 */

import Decimal from "decimal.js";
import type { HoldingForDashboard } from "@/lib/dashboard/build";
import type { FetchOnPricesResult } from "@/lib/market/data912";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import type { HoldingRow } from "@/lib/transactions/types";
import { buildBondHoldings, type FxForBondHoldings, type TradeForBondHoldings } from "./holdings";
import { markToMarket } from "./valuation";

export type ValuatedOnPosition = {
  instrumentId: string;
  ticker: string;
  instrumentName: string;
  nominalHeld: string;
  costBasisUsd: string;
  /** Costo en pesos al CCL del día de cada compra. Ver `costBasisArsOf`. */
  costBasisArs: string;
  /**
   * El costo en pesos salió del CCL de hoy porque falta histórico. El rendimiento en
   * pesos que se derive de él va a parecerse al de dólares: no midió el tipo de cambio.
   */
  arsBasisIsApproximate: boolean;
  marketValueArs: string;
  marketValueUsd: string | null;
  pnlArs: string;
  pnlPercent: string;
  pnlUsd: string | null;
  pnlPercentUsd: string | null;
};

/**
 * Costo en pesos de la posición.
 *
 * Lo correcto es el histórico: cada compra al CCL de su fecha. Cuando falta ese dato se
 * cae al CCL de hoy — que es lo que hacía siempre — para no dejar la posición en cero y
 * romper los totales, pero se avisa con `arsBasisIsApproximate` en vez de disimularlo.
 */
function costBasisArsOf(
  historical: string | null,
  costBasisUsd: string,
  cclRate: number | null
): { value: Decimal; isApproximate: boolean } {
  if (historical !== null) return { value: new Decimal(historical), isApproximate: false };
  if (cclRate && cclRate > 0) {
    return { value: new Decimal(costBasisUsd).mul(cclRate), isApproximate: true };
  }
  return { value: new Decimal(0), isApproximate: true };
}

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
  namesById: Map<string, string>,
  fx?: FxForBondHoldings
): ValuatedOnPosition[] {
  const buySell = trades.filter((t) => t.type === "BUY" || t.type === "SELL");
  const raw = buildBondHoldings(buySell, fx);

  return raw.map((h) => {
    const quote = priceResult.quotes.get(h.ticker.toUpperCase()) ?? null;
    const isStale = priceResult.stale && quote !== null;
    const mtm = markToMarket(h, quote, cclRate, isStale);
    const marketValueArs = mtm.marketValueArs ?? "0";
    const basis = costBasisArsOf(h.costBasisArs, h.costBasisUsd, cclRate);
    const pnlArs = new Decimal(marketValueArs).minus(basis.value);
    const pnlPercent = basis.value.isZero()
      ? new Decimal(0)
      : pnlArs.div(basis.value).mul(100);

    return {
      instrumentId: h.instrumentId,
      ticker: h.ticker,
      instrumentName: namesById.get(h.instrumentId) ?? h.ticker,
      nominalHeld: h.nominalHeld,
      costBasisUsd: h.costBasisUsd,
      costBasisArs: basis.value.toFixed(2),
      arsBasisIsApproximate: basis.isApproximate,
      marketValueArs,
      marketValueUsd: mtm.marketValueUsd,
      pnlArs: pnlArs.toFixed(2),
      pnlPercent: pnlPercent.toFixed(2),
      // La ON cotiza en dólares: su resultado en USD ya es histórico por construcción.
      pnlUsd: mtm.unrealizedPnlUsd,
      pnlPercentUsd: mtm.pctChange,
    };
  });
}

export function toHoldingRow(p: ValuatedOnPosition): HoldingRow {
  const nominal = new Decimal(p.nominalHeld);
  const costBasisArs = p.costBasisArs;
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
    costBasisUsd: p.costBasisUsd,
    marketValueUsd: p.marketValueUsd,
    pnlUsd: p.pnlUsd,
    pnlPercentUsd: p.pnlPercentUsd,
  };
}

export function toDashboardHolding(p: ValuatedOnPosition): HoldingForDashboard {
  return {
    instrumentId: p.instrumentId,
    ticker: p.ticker,
    instrumentName: p.instrumentName,
    instrumentType: "ON",
    quantity: p.nominalHeld,
    costBasisArs: p.costBasisArs,
    marketValueArs: p.marketValueArs,
    pnlArs: p.pnlArs,
    pnlPercent: p.pnlPercent,
    costBasisUsd: p.costBasisUsd,
    marketValueUsd: p.marketValueUsd,
    pnlUsd: p.pnlUsd,
    pnlPercentUsd: p.pnlPercentUsd,
    sector: null,
  };
}
