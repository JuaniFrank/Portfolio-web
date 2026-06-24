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
 * Posición actual: cantidad, PPP derivado y costo en cartera acumulado
 * sumando |netAmount| en compras y restando costo proporcional en ventas.
 */
function computePositionFromTrades(trades: TradeForHoldings[]): {
  quantity: Decimal;
  avgPrice: Decimal;
  costBasisArs: Decimal;
} {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
  );

  let qty = new Decimal(0);
  let totalCost = new Decimal(0);

  for (const t of sorted) {
    const q = new Decimal(t.quantity);
    const net = new Decimal(t.netAmount);

    if (t.type === "BUY") {
      totalCost = totalCost.plus(net.abs());
      qty = qty.plus(q);
    } else {
      if (!qty.isZero()) {
        const costRemoved = totalCost.mul(q.div(qty));
        totalCost = totalCost.minus(costRemoved);
      }
      qty = qty.minus(q);
      if (qty.lt(0)) qty = new Decimal(0);
      if (totalCost.lt(0)) totalCost = new Decimal(0);
    }
  }

  const avgPrice = qty.isZero() ? new Decimal(0) : totalCost.div(qty);

  return { quantity: qty, avgPrice, costBasisArs: totalCost };
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
 */
export function buildHoldings(
  trades: TradeForHoldings[],
  latestPrices: PriceByInstrument,
  events?: Map<string, CorporateEventForBuilder[]>
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
    const { quantity, avgPrice, costBasisArs } = computePositionFromTrades(instrumentTrades);

    if (quantity.lte(0)) continue;

    const currentPrice = latestPrices.has(sample.instrumentId)
      ? new Decimal(latestPrices.get(sample.instrumentId)!)
      : avgPrice;

    const marketValue = quantity.mul(currentPrice);
    const pnl = marketValue.minus(costBasisArs);
    const pnlPercent = costBasisArs.isZero()
      ? new Decimal(0)
      : pnl.div(costBasisArs).mul(100);

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
