import { TimeSeries } from "@/lib/rendimientos/price-series";
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

function utcDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/**
 * A projection context with its lookup series built once, so projecting many trades doesn't
 * rebuild them per trade. Build it with `prepareProjection`.
 */
export type PreparedProjection = {
  kind: UiMonitoringSeriesKind;
  currency: MonitoringCurrency;
  seriesAdjusted: boolean;
  corporateEventDates: string[];
  bars: TimeSeries;
  nativeArsCloses: TimeSeries;
  ccl: TimeSeries;
};

export function prepareProjection(ctx: TradeProjectionContext): PreparedProjection {
  return {
    kind: ctx.kind,
    currency: ctx.currency,
    seriesAdjusted: ctx.seriesAdjusted ?? false,
    corporateEventDates: ctx.corporateEventDates ?? [],
    bars: new TimeSeries(ctx.bars.map((b) => ({ date: utcDay(b.time), value: b.close }))),
    nativeArsCloses: new TimeSeries(
      ctx.nativeArsCloses.map((c) => ({ date: utcDay(c.date), value: c.close }))
    ),
    ccl: new TimeSeries(ctx.cclByDate.map((r) => ({ date: utcDay(r.date), value: r.rate }))),
  };
}

/**
 * Value of the latest point on or before `day`, only if it is at most
 * `PROJECTION_LOOKBACK_DAYS` old: a stale bar or rate would place the trade at the wrong height.
 */
function valueAsOf(series: TimeSeries, day: string): number | null {
  const target = utcDay(day);
  const hit = series.asOf(target);
  if (!hit) return null;
  const ageDays = (target.getTime() - hit.date.getTime()) / DAY_MS;
  return ageDays <= PROJECTION_LOOKBACK_DAYS ? hit.value : null;
}

function isPositive(n: number | undefined | null): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/**
 * Project a trade's price into the scale of the displayed series so it can be drawn at the
 * right height on the chart. Anything that can't be projected reliably yields `chartPrice: null`.
 * For many trades, prepare the context once and use `projectPreparedTradePrice`.
 */
export function projectTradePrice(
  trade: TradeProjectionInput,
  ctx: TradeProjectionContext
): TradeProjection {
  return projectPreparedTradePrice(trade, prepareProjection(ctx));
}

export function projectPreparedTradePrice(
  trade: TradeProjectionInput,
  ctx: PreparedProjection
): TradeProjection {
  if (!isPositive(trade.price)) return MISSING;

  if (ctx.kind === "native") {
    if (ctx.seriesAdjusted && ctx.corporateEventDates.some((d) => d > trade.tradeDate)) {
      return MISSING;
    }
    if (trade.currencyCode === ctx.currency) {
      return { chartPrice: trade.price, method: "direct" };
    }
    const rate = valueAsOf(ctx.ccl, trade.tradeDate);
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
      const rate = valueAsOf(ctx.ccl, trade.tradeDate);
      if (!isPositive(rate)) return MISSING;
      priceArs = trade.price * rate;
    } else {
      return MISSING;
    }

    const underlying = valueAsOf(ctx.bars, trade.tradeDate);
    const cedear = valueAsOf(ctx.nativeArsCloses, trade.tradeDate);
    if (!isPositive(underlying) || !isPositive(cedear)) return MISSING;
    return { chartPrice: priceArs * (underlying / cedear), method: "underlying-factor" };
  }

  return MISSING;
}
