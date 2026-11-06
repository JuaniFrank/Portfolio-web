import type { MonitoringSeries } from "./types";

/**
 * Whether the page should fetch the full history in the background for the given series.
 *
 * A cached series renders immediately but is always refreshed once per page session: the
 * cache only holds what earlier fetches stored, so it never has today's bar (or holds an
 * intraday snapshot of it), and any staleness tolerance hides the latest price.
 * "loaded" and "unavailable" are terminal.
 */
export function shouldLoadHistory(
  series: Pick<MonitoringSeries, "historyStatus"> | null
): boolean {
  if (series === null) return true;

  switch (series.historyStatus) {
    case "not-requested":
    case "live-fallback":
    case "cached":
      return true;
    case "loaded":
    case "unavailable":
      return false;
  }
}
