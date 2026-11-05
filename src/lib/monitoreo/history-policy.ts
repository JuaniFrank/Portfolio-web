import type { MonitoringSeries } from "./types";

const MIN_CACHED_BARS = 15;
const MAX_CACHE_STALENESS_DAYS = 5;
const DAY_MS = 24 * 3600 * 1000;

/**
 * Whether the page should fetch the full history in the background for the given series.
 * A cached series is accepted only when it has enough bars and a recent last date;
 * "loaded" and "unavailable" are terminal.
 */
export function shouldLoadHistory(
  series: Pick<MonitoringSeries, "historyStatus" | "bars" | "lastDate"> | null,
  todayIso: string
): boolean {
  if (series === null) return true;

  switch (series.historyStatus) {
    case "not-requested":
    case "live-fallback":
      return true;
    case "loaded":
    case "unavailable":
      return false;
    case "cached": {
      if (series.bars.length < MIN_CACHED_BARS) return true;
      if (!series.lastDate) return true;
      const ageDays =
        (Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${series.lastDate}T00:00:00Z`)) / DAY_MS;
      return ageDays > MAX_CACHE_STALENESS_DAYS;
    }
  }
}
