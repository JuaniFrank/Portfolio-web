import type { MonitoringBar, MonitoringCurrency, UiMonitoringSeriesKind } from "./types";

export type ProjectionMethod = "direct" | "ccl" | "underlying-factor";

export type TradeProjectionInput = {
  /** YYYY-MM-DD */
  tradeDate: string;
  price: number;
  currencyCode: string;
};

export type TradeProjectionContext = {
  kind: UiMonitoringSeriesKind;
  /** Currency of the displayed series */
  currency: MonitoringCurrency;
  /** The displayed series' bars */
  bars: Pick<MonitoringBar, "time" | "close">[];
  /** The instrument's own ARS EOD closes (sorted ascending by date) */
  nativeArsCloses: { date: string; close: number }[];
  /** CCL (USD/ARS) rates (sorted ascending by date) */
  cclByDate: { date: string; rate: number }[];
  /**
   * true when the displayed series is split-adjusted retroactively (e.g. yahoo-eod): raw trade
   * prices are then not comparable with its bars across a later corporate event.
   */
  seriesAdjusted?: boolean;
  /** Corporate event effective dates (YYYY-MM-DD) of the instrument */
  corporateEventDates?: string[];
};

/** Whether a series' bars are rewritten retroactively for corporate events. */
export function isSeriesAdjusted(series: {
  source: string;
  adjustmentPolicy: string;
}): boolean {
  return series.adjustmentPolicy === "split-adjusted" || series.source === "yahoo-eod";
}

export type TradeProjection =
  | { chartPrice: number; method: ProjectionMethod }
  | { chartPrice: null; method: null };

/** Maximum calendar-day gap accepted when looking up a bar/rate on or before the trade date. */
export const PROJECTION_LOOKBACK_DAYS = 5;

const MISSING: TradeProjection = { chartPrice: null, method: null };
const DAY_MS = 24 * 3600 * 1000;

function daysBetween(earlier: string, later: string): number {
  return (Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / DAY_MS;
}

/**
 * Latest entry with date <= `date` and within the lookback window. Assumes `items` is sorted
 * ascending by date (binary search).
 */
function asOf<T>(
  items: T[],
  getDate: (item: T) => string,
  date: string,
  lookbackDays = PROJECTION_LOOKBACK_DAYS
): T | null {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (getDate(items[mid]!) <= date) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return null;
  const item = items[found]!;
  return daysBetween(getDate(item), date) <= lookbackDays ? item : null;
}

function isPositive(n: number | undefined | null): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Project a trade's price into the scale of the displayed series so it can be drawn at the
 * right height on the chart. Anything that can't be projected reliably yields `chartPrice: null`.
 */
export function projectTradePrice(
  trade: TradeProjectionInput,
  ctx: TradeProjectionContext
): TradeProjection {
  if (!isPositive(trade.price)) return MISSING;

  if (ctx.kind === "native") {
    if (ctx.seriesAdjusted && (ctx.corporateEventDates ?? []).some((d) => d > trade.tradeDate)) {
      return MISSING;
    }
    if (trade.currencyCode === ctx.currency) {
      return { chartPrice: trade.price, method: "direct" };
    }
    const rate = asOf(ctx.cclByDate, (r) => r.date, trade.tradeDate)?.rate;
    if (!isPositive(rate)) return MISSING;
    if (ctx.currency === "ARS" && trade.currencyCode === "USD") {
      return { chartPrice: trade.price * rate, method: "ccl" };
    }
    if (ctx.currency === "USD" && trade.currencyCode === "ARS") {
      return { chartPrice: trade.price / rate, method: "ccl" };
    }
    return MISSING;
  }

  if (ctx.kind === "cedear-underlying") {
    let priceArs: number;
    if (trade.currencyCode === "ARS") {
      priceArs = trade.price;
    } else if (trade.currencyCode === "USD") {
      const rate = asOf(ctx.cclByDate, (r) => r.date, trade.tradeDate)?.rate;
      if (!isPositive(rate)) return MISSING;
      priceArs = trade.price * rate;
    } else {
      return MISSING;
    }

    const underlying = asOf(ctx.bars, (b) => b.time, trade.tradeDate)?.close;
    const cedear = asOf(ctx.nativeArsCloses, (c) => c.date, trade.tradeDate)?.close;
    if (!isPositive(underlying) || !isPositive(cedear)) return MISSING;
    return { chartPrice: priceArs * (underlying / cedear), method: "underlying-factor" };
  }

  return MISSING;
}
