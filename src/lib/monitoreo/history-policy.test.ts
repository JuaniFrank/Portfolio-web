import { describe, expect, it } from "vitest";
import { shouldLoadHistory } from "./history-policy";
import type { MonitoringHistoryStatus } from "./types";

const TODAY = "2026-03-20";

function series(historyStatus: MonitoringHistoryStatus, barCount = 100, lastDate: string | null = "2026-03-19") {
  return { historyStatus, bars: new Array(barCount).fill(null), lastDate };
}

describe("monitoreo/history-policy shouldLoadHistory", () => {
  it("loads when there is no series", () => {
    expect(shouldLoadHistory(null, TODAY)).toBe(true);
  });

  it("loads for not-requested and live-fallback", () => {
    expect(shouldLoadHistory(series("not-requested"), TODAY)).toBe(true);
    expect(shouldLoadHistory(series("live-fallback", 1), TODAY)).toBe(true);
  });

  it("does not load when already loaded or unavailable", () => {
    expect(shouldLoadHistory(series("loaded", 1, null), TODAY)).toBe(false);
    expect(shouldLoadHistory(series("unavailable", 0, null), TODAY)).toBe(false);
  });

  it("accepts a fresh, sufficient cache", () => {
    expect(shouldLoadHistory(series("cached", 100, "2026-03-19"), TODAY)).toBe(false);
  });

  it("loads when the cache has fewer than 15 bars", () => {
    expect(shouldLoadHistory(series("cached", 14), TODAY)).toBe(true);
    expect(shouldLoadHistory(series("cached", 15), TODAY)).toBe(false);
  });

  it("loads when the cache is more than 5 calendar days stale", () => {
    expect(shouldLoadHistory(series("cached", 100, "2026-03-15"), TODAY)).toBe(false); // exactly 5
    expect(shouldLoadHistory(series("cached", 100, "2026-03-14"), TODAY)).toBe(true);
  });

  it("loads a cached series with no last date", () => {
    expect(shouldLoadHistory(series("cached", 100, null), TODAY)).toBe(true);
  });
});
