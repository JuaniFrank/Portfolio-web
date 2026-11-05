import { projectTradePrice, type ProjectionMethod, type TradeProjectionContext } from "./trade-projection";
import type { MonitoringBar } from "./types";

export type TradeSide = "BUY" | "SELL";

/**
 * Plain trade shape consumed by the marker logic — the server action serializes Prisma's
 * `Transaction` (Decimal/Date fields) into these before calling into this pure module.
 */
export type TradeMarkerInput = {
  id: string;
  /** YYYY-MM-DD */
  tradeDate: string;
  type: TradeSide;
  quantity: number;
  price: number;
  currencyCode: string;
  grossAmount: number;
  fees: number;
};

/** Chronological order with BUY before SELL on the same day (a same-day sell can't precede its buy). */
function compareChronological(
  a: { tradeDate: string; side: TradeMarkerSide },
  b: { tradeDate: string; side: TradeMarkerSide }
): number {
  const byDate = a.tradeDate.localeCompare(b.tradeDate);
  if (byDate !== 0) return byDate;
  return (a.side === "buy" ? 0 : 1) - (b.side === "buy" ? 0 : 1);
}

/** Projection inputs for the displayed series (the bars are passed separately). */
export type TradeMarkerContext = Omit<TradeProjectionContext, "bars">;

export type TradeMarkerTrade = {
  id: string;
  tradeDate: string;
  side: TradeSide;
  quantity: number;
  price: number;
  currencyCode: string;
  grossAmount: number;
  fees: number;
  /** null when the trade could not be projected or a corporate event followed it */
  changeSinceTradePct: number | null;
};

export type TradeMarkerSide = "buy" | "sell";

export type TradeMarker = {
  /** Same as the trade id */
  id: string;
  /** Bar date (YYYY-MM-DD) this marker is snapped to — never the raw trade date */
  barTime: string;
  side: TradeMarkerSide;
  trade: TradeMarkerTrade;
  /** Trade price in the displayed series' scale; null when it could not be projected */
  chartPrice: number | null;
  /** true when `chartPrice` is null and the marker falls back to date placement */
  approximate: boolean;
  projectionMethod: ProjectionMethod | null;
};

/** A trade as listed: a `TradeMarker` whose bar may be missing (outside the bar range). */
export type TradeEntry = Omit<TradeMarker, "barTime"> & { barTime: string | null };

/** A trade with its price projected into the displayed series' scale, independent of range. */
export type ProjectedTrade = {
  id: string;
  tradeDate: string;
  side: TradeMarkerSide;
  quantity: number;
  chartPrice: number | null;
  projectionMethod: ProjectionMethod | null;
  trade: TradeMarkerInput;
};

export type PositionSummary = {
  quantity: number;
  /** Average cost in chart scale; null when not computable */
  avgCost: number | null;
  unrealizedPct: number | null;
  /** false when a missing projection or a later corporate event blocks the comparison */
  comparable: boolean;
};

/**
 * Find the bar date a trade snaps to: the first bar on/after the trade date. Trades outside
 * the bar range (before the first bar or after the last bar) are dropped — there's no bar to
 * anchor the marker to, and markers only ever render on a visible bar.
 */
function snapToBarDate(tradeDate: string, bars: MonitoringBar[]): string | null {
  if (bars.length === 0) return null;
  const firstBar = bars[0]!;
  const lastBar = bars[bars.length - 1]!;
  if (tradeDate < firstBar.time || tradeDate > lastBar.time) return null;

  for (const b of bars) {
    if (b.time >= tradeDate) return b.time;
  }
  return null;
}

/**
 * Project every trade into the displayed series' scale. Unlike markers, this is not clipped
 * to the visible bars, so position math can use the whole trade history.
 */
export function projectTrades(
  trades: TradeMarkerInput[],
  ctx: TradeProjectionContext
): ProjectedTrade[] {
  return trades
    .map((trade) => {
      const { chartPrice, method } = projectTradePrice(trade, ctx);
      return {
        id: trade.id,
        tradeDate: trade.tradeDate,
        side: trade.type === "BUY" ? ("buy" as const) : ("sell" as const),
        quantity: trade.quantity,
        chartPrice,
        projectionMethod: method,
        trade,
      };
    })
    .sort(compareChronological);
}

/**
 * One entry per trade, in chronological order. `barTime` is the bar the trade snaps to, or null
 * when it falls outside the bar range (no bar to anchor to): such trades still belong in the
 * trades list and the position math, they just have no chart marker. `projectionBars` (default
 * `bars`) lets callers project against the full series while anchoring to a visible subset.
 */
export function buildTradeEntries(
  trades: TradeMarkerInput[],
  bars: MonitoringBar[],
  ctx: TradeMarkerContext,
  corporateEventDates: string[] = [],
  projectionBars: MonitoringBar[] = bars
): TradeEntry[] {
  if (trades.length === 0) return [];

  const lastClose = bars.length > 0 ? bars[bars.length - 1]!.close : null;
  const projected = projectTrades(trades, { ...ctx, bars: projectionBars });

  const entries = projected.map((p): TradeEntry => {
    const changeSinceTradePct =
      lastClose !== null && p.chartPrice !== null && !corporateEventDates.some((d) => d > p.tradeDate)
        ? ((lastClose - p.chartPrice) / p.chartPrice) * 100
        : null;

    return {
      id: p.id,
      barTime: snapToBarDate(p.tradeDate, bars),
      side: p.side,
      trade: {
        id: p.trade.id,
        tradeDate: p.trade.tradeDate,
        side: p.trade.type,
        quantity: p.trade.quantity,
        price: p.trade.price,
        currencyCode: p.trade.currencyCode,
        grossAmount: p.trade.grossAmount,
        fees: p.trade.fees,
        changeSinceTradePct,
      },
      chartPrice: p.chartPrice,
      approximate: p.chartPrice === null,
      projectionMethod: p.projectionMethod,
    };
  });

  // `projected` is already sorted by trade date and Array#sort is stable.
  return entries;
}

/**
 * Build one marker per trade that has a bar to anchor to, positioned at the trade's projected
 * chart price. Trades outside the bar range are not returned (see `buildTradeEntries` for those).
 */
export function buildTradeMarkers(
  trades: TradeMarkerInput[],
  bars: MonitoringBar[],
  ctx: TradeMarkerContext,
  corporateEventDates: string[] = [],
  projectionBars: MonitoringBar[] = bars
): TradeMarker[] {
  if (bars.length === 0) return [];
  return buildTradeEntries(trades, bars, ctx, corporateEventDates, projectionBars)
    .filter((e): e is TradeMarker => e.barTime !== null)
    .sort((a, b) => a.barTime.localeCompare(b.barTime));
}

const QUANTITY_EPSILON = 1e-9;

/**
 * Open-position summary in chart scale using the average-cost method: buys add quantity and
 * cost at their chart price, sells reduce quantity at the current average (which stays
 * unchanged), and the state resets when the position closes. A buy without a chart price, or
 * a corporate event after any trade of the open position, makes the average meaningless:
 * quantity is still reported but `avgCost`/`unrealizedPct` are null and `comparable` is false.
 * (Sells never use their own price, so a sell without projection does not block the average.)
 */
export function buildPositionSummary(
  trades: { side: TradeMarkerSide; quantity: number; chartPrice: number | null; tradeDate: string }[],
  lastClose: number,
  corporateEventDates: string[] = []
): PositionSummary {
  const sorted = [...trades].sort(compareChronological);

  let quantity = 0;
  let cost = 0;
  let openSince: string | null = null;
  let missingPrice = false;

  for (const t of sorted) {
    if (t.side === "buy") {
      if (quantity <= QUANTITY_EPSILON) {
        quantity = 0;
        cost = 0;
        openSince = t.tradeDate;
        missingPrice = false;
      }
      quantity += t.quantity;
      if (t.chartPrice === null) missingPrice = true;
      else cost += t.quantity * t.chartPrice;
    } else if (quantity > QUANTITY_EPSILON) {
      const avg = cost / quantity;
      const sold = Math.min(t.quantity, quantity);
      quantity -= sold;
      cost -= sold * avg;
      if (quantity <= QUANTITY_EPSILON) {
        quantity = 0;
        cost = 0;
        openSince = null;
        missingPrice = false;
      }
    }
  }

  if (quantity <= QUANTITY_EPSILON) {
    return { quantity: 0, avgCost: null, unrealizedPct: null, comparable: true };
  }

  const brokenByEvent =
    openSince !== null && corporateEventDates.some((d) => d > openSince!);
  if (missingPrice || brokenByEvent) {
    return { quantity, avgCost: null, unrealizedPct: null, comparable: false };
  }

  const avgCost = cost / quantity;
  const unrealizedPct = avgCost > 0 ? ((lastClose - avgCost) / avgCost) * 100 : null;
  return { quantity, avgCost, unrealizedPct, comparable: true };
}
