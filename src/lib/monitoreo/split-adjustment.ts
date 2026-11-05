import Decimal from "decimal.js";
import { adjustBarsForEvents, type HistoricalBar } from "@/lib/events/apply";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import {
  DATA912_EOD_SOURCE,
  DATA912_LIVE_SOURCE,
  FMP_EOD_SOURCE,
  YAHOO_EOD_SOURCE,
  YAHOO_UNDERLYING_EOD_SOURCE,
} from "@/lib/market/provider-routing";
import type { AdjustmentEvent, MonitoringAdjustmentPolicy, MonitoringBar } from "./types";

/**
 * Read-time split adjustment of /activos series. PriceCache keeps storing what each provider
 * sent (raw for data912/FMP); this module only rewrites the copy that is returned to the page,
 * so turning it off (env switch or the UI toggle) restores the previous behavior exactly.
 */

/** Who is responsible for putting the stored bars on the post-event scale. */
export type AdjustmentMode =
  /** Raw nominal: adjust with the instrument's own CorporateEvents. */
  | "instrument-events"
  /** Raw underlying prices (FMP non-split-adjusted): adjust with the underlying's real splits. */
  | "underlying-splits"
  /** Yahoo already rewrote the series: never adjust again. */
  | "provider"
  | "none";

export function adjustmentModeForSource(source: string): AdjustmentMode {
  switch (source) {
    case DATA912_EOD_SOURCE:
    case DATA912_LIVE_SOURCE:
      return "instrument-events";
    case FMP_EOD_SOURCE:
      return "underlying-splits";
    case YAHOO_EOD_SOURCE:
    case YAHOO_UNDERLYING_EOD_SOURCE:
      return "provider";
    default:
      return "none";
  }
}

/** A real split of the underlying (e.g. from Yahoo). */
export type SplitInput = { date: string; numerator: number; denominator: number };

/** Same filtering as `adjustBarsForEvents`: ticker changes and degenerate ratios scale nothing. */
export function toAdjustmentEvents(events: CorporateEventForBuilder[]): AdjustmentEvent[] {
  const out: AdjustmentEvent[] = [];
  for (const event of events) {
    if (event.eventType === "TICKER_CHANGE") continue;
    const denominator = new Decimal(event.denominator);
    const numerator = new Decimal(event.numerator);
    if (denominator.isZero() || numerator.isZero()) continue;
    out.push({ effectiveDate: event.effectiveDate, ratio: numerator.div(denominator).toNumber() });
  }
  return out;
}

/**
 * Product of the ratios of the events that happen strictly after `day` (YYYY-MM-DD). Same
 * comparison as `applyEventsToTrade` (`tradeDay >= effectiveDate` is post-event).
 */
export function adjustmentFactorAfter(day: string, events: AdjustmentEvent[]): number {
  let factor = new Decimal(1);
  for (const event of events) {
    if (day >= event.effectiveDate) continue;
    factor = factor.mul(event.ratio);
  }
  return factor.toNumber();
}

/** Underlying splits in the shape `adjustBarsForEvents` consumes. */
export function splitsToEvents(splits: SplitInput[]): CorporateEventForBuilder[] {
  return splits.map((s) => ({
    instrumentId: "",
    eventType: s.numerator < s.denominator ? "REVERSE_SPLIT" : "STOCK_SPLIT",
    effectiveDate: s.date,
    numerator: String(s.numerator),
    denominator: String(s.denominator),
  }));
}

/** `adjustBarsForEvents` over `MonitoringBar`s (YYYY-MM-DD <-> Date). Volume is not adjusted. */
export function adjustMonitoringBars(
  bars: MonitoringBar[],
  events: CorporateEventForBuilder[]
): MonitoringBar[] {
  if (events.length === 0 || bars.length === 0) return bars;

  const historical: HistoricalBar[] = bars.map((b) => ({
    date: new Date(`${b.time}T00:00:00.000Z`),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
  const adjusted = adjustBarsForEvents(historical, events);

  return adjusted.map((h, i) =>
    h === historical[i] ? bars[i]! : { ...bars[i]!, open: h.open, high: h.high, low: h.low, close: h.close }
  );
}

export type SeriesAdjustment = {
  bars: MonitoringBar[];
  policy: MonitoringAdjustmentPolicy;
  /** Events applied to `bars` by us (empty unless policy is "split-adjusted") */
  events: AdjustmentEvent[];
  warning: string | null;
};

export const SPLITS_UNAVAILABLE_WARNING =
  "No pudimos obtener los splits del subyacente: el precio se muestra sin ajustar";

/**
 * Decide and apply the adjustment of one series.
 * - `enabled`: the server-side kill switch. When false the result is exactly the legacy one.
 * - `adjusted`: the user's toggle. Provider sources can't be un-adjusted, so they stay
 *   "provider-adjusted" either way.
 * - `underlyingSplits`: null means they could not be fetched (served raw + warning).
 */
export function resolveSeriesAdjustment(input: {
  source: string;
  bars: MonitoringBar[];
  enabled: boolean;
  adjusted: boolean;
  instrumentEvents: CorporateEventForBuilder[];
  underlyingSplits: SplitInput[] | null;
}): SeriesAdjustment {
  const raw: SeriesAdjustment = { bars: input.bars, policy: "raw", events: [], warning: null };
  if (!input.enabled) return raw;

  const mode = adjustmentModeForSource(input.source);
  if (mode === "provider") return { ...raw, policy: "provider-adjusted" };
  if (!input.adjusted || mode === "none") return raw;

  if (mode === "instrument-events") {
    return {
      bars: adjustMonitoringBars(input.bars, input.instrumentEvents),
      policy: "split-adjusted",
      events: toAdjustmentEvents(input.instrumentEvents),
      warning: null,
    };
  }

  // underlying-splits
  if (input.underlyingSplits === null) return { ...raw, warning: SPLITS_UNAVAILABLE_WARNING };
  const events = splitsToEvents(input.underlyingSplits);
  return {
    bars: adjustMonitoringBars(input.bars, events),
    policy: "split-adjusted",
    events: toAdjustmentEvents(events),
    warning: null,
  };
}

/**
 * What the trade side needs, given the series it is drawn on:
 * - `adjustmentEvents`: when defined, trade prices are divided by the ratio of later events
 *   (`projectTradePrice`) and a later event no longer blocks comparability.
 * - `gatingEventDates`: the legacy gating input (raw and provider-adjusted series keep it).
 */
export function resolveTradeAdjustment(
  series: { adjustmentPolicy: MonitoringAdjustmentPolicy; adjustmentEvents: AdjustmentEvent[] },
  tradeData: { corporateEvents: AdjustmentEvent[]; corporateEventDates: string[] }
): { adjustmentEvents: AdjustmentEvent[] | undefined; gatingEventDates: string[] } {
  if (series.adjustmentPolicy === "split-adjusted") {
    return { adjustmentEvents: series.adjustmentEvents, gatingEventDates: [] };
  }
  if (series.adjustmentPolicy === "provider-adjusted") {
    // Yahoo's rewrite is not guaranteed to match our CorporateEvents: keep the legacy behavior
    // (pre-event trades are approximate, later events gate the comparison).
    return { adjustmentEvents: undefined, gatingEventDates: tradeData.corporateEventDates };
  }
  return { adjustmentEvents: undefined, gatingEventDates: tradeData.corporateEventDates };
}

/**
 * Symbol whose real splits adjust an `fmp-eod` series: the underlying for a CEDEAR, the own
 * ticker otherwise (same resolution as `resolveMonitoringRouting` for the FMP branches).
 */
export function underlyingSplitSymbol(instrument: {
  type: string;
  ticker: string;
  underlyingAsset?: { ticker: string } | null;
}): string {
  return instrument.type === "CEDEAR"
    ? instrument.underlyingAsset?.ticker || instrument.ticker
    : instrument.ticker;
}

/** Footer label of the series' adjustment (Spanish, user-facing). */
export function adjustmentPolicyLabel(policy: MonitoringAdjustmentPolicy): string {
  switch (policy) {
    case "split-adjusted":
      return "ajustado por splits";
    case "provider-adjusted":
      return "ajustado por el proveedor";
    default:
      return "sin ajustar";
  }
}
