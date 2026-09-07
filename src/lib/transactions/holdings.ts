import Decimal from "decimal.js";
import type { HoldingRow } from "./types";
import { applyEventsToTrade } from "@/lib/events/apply";
import type { CorporateEventForBuilder } from "@/lib/events/types";

export type TradeForHoldings = {
  instrumentId: string;
  ticker: string;
  instrumentType: HoldingRow["instrumentType"];
  instrumentName: string;
  type: "BUY" | "SELL";
  quantity: string;
  price: string;
  netAmount: string;
  tradeDate: string;
};

export type PriceByInstrument = Map<string, string>;

/**
 * Exchange-rate context for the USD side of a position.
 *
 * A dollar return only means something when each purchase is converted at the CCL of
 * the day it happened. Converting cost and market value at the same current rate makes
 * the rate cancel out, and the USD percentage collapses onto the ARS one — which in a
 * country whose exchange rate moves as much as the assets do is a number that says
 * nothing.
 */
export type FxForHoldings = {
  /** CCL as of a trade date. `null` when the history does not reach that far back. */
  cclAt: (tradeDate: Date) => number | null;
  /** Today's CCL, used to value the position at market in USD. */
  currentCcl: number | null;
};

/**
 * Posición actual: cantidad, PPP derivado y costo en cartera acumulado
 * sumando |netAmount| en compras y restando costo proporcional en ventas.
 *
 * El costo en dólares sigue exactamente el mismo replay, pero convirtiendo cada compra
 * al CCL de su propia fecha. `null` cuando falta el CCL de alguna compra: un costo en
 * dólares a medias es peor que no mostrarlo.
 */
function computePositionFromTrades(
  trades: TradeForHoldings[],
  fx?: FxForHoldings
): {
  quantity: Decimal;
  avgPrice: Decimal;
  costBasisArs: Decimal;
  costBasisUsd: Decimal | null;
} {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
  );

  let qty = new Decimal(0);
  let totalCost = new Decimal(0);
  let totalCostUsd = new Decimal(0);
  let usdIsMeasurable = fx !== undefined;

  for (const t of sorted) {
    const q = new Decimal(t.quantity);
    const net = new Decimal(t.netAmount);

    if (t.type === "BUY") {
      totalCost = totalCost.plus(net.abs());
      if (usdIsMeasurable) {
        const rate = fx!.cclAt(new Date(t.tradeDate));
        if (!rate || rate <= 0) usdIsMeasurable = false;
        else totalCostUsd = totalCostUsd.plus(net.abs().div(rate));
      }
      qty = qty.plus(q);
    } else {
      if (!qty.isZero()) {
        const soldShare = q.div(qty);
        totalCost = totalCost.minus(totalCost.mul(soldShare));
        totalCostUsd = totalCostUsd.minus(totalCostUsd.mul(soldShare));
      }
      qty = qty.minus(q);
      if (qty.lt(0)) qty = new Decimal(0);
      if (totalCost.lt(0)) totalCost = new Decimal(0);
      if (totalCostUsd.lt(0)) totalCostUsd = new Decimal(0);
    }
  }

  const avgPrice = qty.isZero() ? new Decimal(0) : totalCost.div(qty);

  return {
    quantity: qty,
    avgPrice,
    costBasisArs: totalCost,
    costBasisUsd: usdIsMeasurable ? totalCostUsd : null,
  };
}

/**
 * Build holdings from a list of trades.
 *
 * @param trades - All BUY/SELL trades to process.
 * @param latestPrices - Map of instrumentId → latest price string.
 * @param events - Optional map of instrumentId → corporate events sorted ascending
 *   by effectiveDate. When provided, pre-event trades (tradeDate < effectiveDate)
 *   are adjusted by the event ratio before entering PPP math.
 *   Backwards compatible: omitting this param is a no-op.
 * @param fx - Optional CCL context. When provided, every position also carries its USD
 *   cost basis at the historical rate of each purchase and the USD P&L derived from it.
 *   Omitting it leaves the USD fields null.
 */
export function buildHoldings(
  trades: TradeForHoldings[],
  latestPrices: PriceByInstrument,
  events?: Map<string, CorporateEventForBuilder[]>,
  fx?: FxForHoldings
): HoldingRow[] {
  const byInstrument = new Map<string, TradeForHoldings[]>();

  for (const t of trades) {
    const instrumentEvents = events?.get(t.instrumentId);
    const adjusted =
      instrumentEvents && instrumentEvents.length > 0
        ? applyEventsToTrade(t, instrumentEvents)
        : t;
    const list = byInstrument.get(t.instrumentId) ?? [];
    list.push(adjusted);
    byInstrument.set(t.instrumentId, list);
  }

  const holdings: HoldingRow[] = [];

  for (const [, instrumentTrades] of byInstrument) {
    const sample = instrumentTrades[0]!;
    const { quantity, avgPrice, costBasisArs, costBasisUsd } = computePositionFromTrades(
      instrumentTrades,
      fx
    );

    if (quantity.lte(0)) continue;

    const currentPrice = latestPrices.has(sample.instrumentId)
      ? new Decimal(latestPrices.get(sample.instrumentId)!)
      : avgPrice;

    const marketValue = quantity.mul(currentPrice);
    const pnl = marketValue.minus(costBasisArs);
    const pnlPercent = costBasisArs.isZero()
      ? new Decimal(0)
      : pnl.div(costBasisArs).mul(100);

    // El valor de mercado sí va al CCL de hoy: es lo que vale hoy. Lo que no puede ir al
    // CCL de hoy es el costo, que se pagó a otro tipo de cambio.
    const marketValueUsd =
      fx?.currentCcl && fx.currentCcl > 0 ? marketValue.div(fx.currentCcl) : null;
    const pnlUsd =
      costBasisUsd && marketValueUsd ? marketValueUsd.minus(costBasisUsd) : null;
    const pnlPercentUsd =
      pnlUsd && costBasisUsd && !costBasisUsd.isZero()
        ? pnlUsd.div(costBasisUsd).mul(100)
        : null;

    holdings.push({
      instrumentId: sample.instrumentId,
      ticker: sample.ticker,
      instrumentType: sample.instrumentType,
      instrumentName: sample.instrumentName,
      quantity: quantity.toFixed(4).replace(/\.?0+$/, ""),
      avgPriceArs: avgPrice.toFixed(2),
      costBasisArs: costBasisArs.toFixed(2),
      currentPriceArs: currentPrice.toFixed(2),
      marketValueArs: marketValue.toFixed(2),
      pnlArs: pnl.toFixed(2),
      pnlPercent: pnlPercent.toFixed(2),
      costBasisUsd: costBasisUsd?.toFixed(2) ?? null,
      marketValueUsd: marketValueUsd?.toFixed(2) ?? null,
      pnlUsd: pnlUsd?.toFixed(2) ?? null,
      pnlPercentUsd: pnlPercentUsd?.toFixed(2) ?? null,
    });
  }

  return holdings.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export function computePortfolioSummary(holdings: HoldingRow[]) {
  let totalValue = new Decimal(0);
  let totalCost = new Decimal(0);

  for (const h of holdings) {
    totalValue = totalValue.plus(new Decimal(h.marketValueArs));
    totalCost = totalCost.plus(new Decimal(h.costBasisArs));
  }

  const pnl = totalValue.minus(totalCost);
  const pnlPercent = totalCost.isZero() ? new Decimal(0) : pnl.div(totalCost).mul(100);

  return {
    totalValueArs: totalValue.toFixed(2),
    totalCostArs: totalCost.toFixed(2),
    totalPnlArs: pnl.toFixed(2),
    totalPnlPercent: pnlPercent.toFixed(2),
  };
}
