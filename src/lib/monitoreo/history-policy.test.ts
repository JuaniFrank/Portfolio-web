import { describe, expect, it } from "vitest";
import { shouldLoadHistory } from "./history-policy";
import type { MonitoringHistoryStatus } from "./types";

function series(historyStatus: MonitoringHistoryStatus, barCount = 100, lastDate: string | null = "2026-03-19") {
  return { historyStatus, bars: new Array(barCount).fill(null), lastDate };
}

describe("monitoreo/history-policy shouldLoadHistory", () => {
  it("loads when there is no series", () => {
    expect(shouldLoadHistory(null)).toBe(true);
  });

  it("loads for not-requested and live-fallback", () => {
    expect(shouldLoadHistory(series("not-requested"))).toBe(true);
    expect(shouldLoadHistory(series("live-fallback", 1))).toBe(true);
  });

  it("does not load when already loaded or unavailable", () => {
    expect(shouldLoadHistory(series("loaded", 1, null))).toBe(false);
    expect(shouldLoadHistory(series("unavailable", 0, null))).toBe(false);
  });

  it("refreshes a cached series even when its last bar is yesterday's", () => {
    // The cache only holds what earlier fetches stored: today's bar (intraday or just closed)
    // is never in it, so a one-day-old cache is exactly the case that misses today's price.
    expect(shouldLoadHistory(series("cached", 100, "2026-03-19"))).toBe(true);
  });

  it("refreshes a cached series whose last bar is today's (it may be an intraday snapshot)", () => {
    expect(shouldLoadHistory(series("cached", 500, "2026-03-20"))).toBe(true);
  });

  it("refreshes a short or dateless cached series", () => {
    expect(shouldLoadHistory(series("cached", 14))).toBe(true);
    expect(shouldLoadHistory(series("cached", 100, null))).toBe(true);
  });
});
