import type { MonitoringBar } from "./types";

export type HeaderStats = {
  lastPrice: number | null;
  lastDate: string | null;
  /** Change vs the previous bar of the FULL series (independent of the selected range) */
  dayChangeAbs: number | null;
  dayChangePct: number | null;
  /** Change from the first displayed close to the last close */
  rangeChangePct: number | null;
  rangeHigh: number | null;
  rangeLow: number | null;
};

/**
 * Header figures for the asset page. The last price and day change come from the full series;
 * the range change and high/low only look at the bars currently displayed.
 */
export function buildHeaderStats(allBars: MonitoringBar[], displayedBars: MonitoringBar[]): HeaderStats {
  const last = allBars[allBars.length - 1];
  if (!last) {
    return {
      lastPrice: null,
      lastDate: null,
      dayChangeAbs: null,
      dayChangePct: null,
      rangeChangePct: null,
      rangeHigh: null,
      rangeLow: null,
    };
  }

  const prev = allBars.length > 1 ? allBars[allBars.length - 2]! : null;
  const dayChangeAbs = prev ? last.close - prev.close : null;
  const dayChangePct = prev && prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : null;

  const first = displayedBars[0];
  const rangeChangePct =
    first && displayedBars.length > 1 && first.close > 0
      ? ((last.close - first.close) / first.close) * 100
      : null;

  let rangeHigh: number | null = null;
  let rangeLow: number | null = null;
  for (const b of displayedBars) {
    const high = b.high ?? b.close;
    const low = b.low ?? b.close;
    if (rangeHigh === null || high > rangeHigh) rangeHigh = high;
    if (rangeLow === null || low < rangeLow) rangeLow = low;
  }

  return {
    lastPrice: last.close,
    lastDate: last.time,
    dayChangeAbs,
    dayChangePct,
    rangeChangePct,
    rangeHigh,
    rangeLow,
  };
}
