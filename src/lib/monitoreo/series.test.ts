import { describe, expect, it } from "vitest";
import {
  buildMonitoringSeries,
  calculateChangePct,
  calculateDataQuality,
  dedupeAndSortBars,
  filterBarsByRange,
  mergeHistoryBars,
  validateOhlc,
} from "./series";
import type { MonitoringBar } from "./types";

describe("monitoreo/series", () => {
  describe("dedupeAndSortBars", () => {
    it("sorts bars chronologically and deduplicates by time keeping the latest", () => {
      const input: MonitoringBar[] = [
        { time: "2026-03-02", open: 100, high: 105, low: 99, close: 104, volume: 1000 },
        { time: "2026-03-01", open: 90, high: 95, low: 88, close: 92, volume: 500 },
        { time: "2026-03-01", open: 91, high: 96, low: 89, close: 95, volume: 600 },
      ];

      const result = dedupeAndSortBars(input);
      expect(result).toHaveLength(2);
      expect(result[0]!.time).toBe("2026-03-01");
      expect(result[0]!.close).toBe(95); // Latest 2026-03-01 entry kept
      expect(result[1]!.time).toBe("2026-03-02");
      expect(result[1]!.close).toBe(104);
    });
  });

  describe("filterBarsByRange", () => {
    const bars: MonitoringBar[] = [
      { time: "2026-01-01", open: 10, high: 12, low: 9, close: 11, volume: 100 },
      { time: "2026-02-01", open: 11, high: 13, low: 10, close: 12, volume: 100 },
      { time: "2026-02-15", open: 12, high: 14, low: 11, close: 13, volume: 100 },
      { time: "2026-03-01", open: 13, high: 15, low: 12, close: 14, volume: 100 },
    ];
    const refDate = new Date(Date.UTC(2026, 2, 1)); // 2026-03-01

    it("returns all bars when range is ALL", () => {
      const result = filterBarsByRange(bars, "ALL", refDate);
      expect(result).toHaveLength(4);
    });

    it("filters bars within 30 days for 1M", () => {
      const result = filterBarsByRange(bars, "1M", refDate);
      // Cutoff: 2026-03-01 - 30 days = 2026-01-30. Includes Feb 1, Feb 15, Mar 1
      expect(result.map((b) => b.time)).toEqual(["2026-02-01", "2026-02-15", "2026-03-01"]);
    });
  });

  describe("validateOhlc", () => {
    it("marks full valid OHLC as valid and complete", () => {
      const bar: MonitoringBar = {
        time: "2026-03-01",
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 5000,
      };
      expect(validateOhlc(bar)).toEqual({ isValid: true, isComplete: true });
    });

    it("detects invalid OHLC where low > close or high < open", () => {
      const bar: MonitoringBar = {
        time: "2026-03-01",
        open: 100,
        high: 90, // high < open
        low: 95,
        close: 85,
        volume: 5000,
      };
      expect(validateOhlc(bar)).toEqual({ isValid: false, isComplete: true });
    });

    it("detects incomplete OHLC when open/high/low are null but close is valid", () => {
      const bar: MonitoringBar = {
        time: "2026-03-01",
        open: null,
        high: null,
        low: null,
        close: 105,
        volume: null,
      };
      expect(validateOhlc(bar)).toEqual({ isValid: true, isComplete: false });
    });
  });

  describe("calculateChangePct", () => {
    it("returns null for empty bars", () => {
      expect(calculateChangePct([])).toEqual({ lastValue: null, changePct: null });
    });

    it("returns changePct null for single bar (first point is null, not 0%)", () => {
      const bars: MonitoringBar[] = [
        { time: "2026-03-01", open: 100, high: 105, low: 95, close: 100, volume: 100 },
      ];
      expect(calculateChangePct(bars)).toEqual({ lastValue: 100, changePct: null });
    });

    it("calculates percentage change correctly for multiple bars", () => {
      const bars: MonitoringBar[] = [
        { time: "2026-03-01", open: 100, high: 105, low: 95, close: 100, volume: 100 },
        { time: "2026-03-02", open: 100, high: 115, low: 98, close: 110, volume: 200 },
      ];
      const result = calculateChangePct(bars);
      expect(result.lastValue).toBe(110);
      expect(result.changePct).toBeCloseTo(10, 2); // +10%
    });
  });

  describe("mergeHistoryBars", () => {
    it("merges external history with cached bars without duplicates", () => {
      const cached: MonitoringBar[] = [
        { time: "2026-03-01", open: 100, high: 105, low: 95, close: 100, volume: 100 },
        { time: "2026-03-02", open: 100, high: 110, low: 98, close: 105, volume: 150 },
      ];
      const external: MonitoringBar[] = [
        { time: "2026-02-28", open: 95, high: 99, low: 90, close: 98, volume: 80 },
        { time: "2026-03-01", open: 99, high: 104, low: 94, close: 100, volume: 100 },
        { time: "2026-03-03", open: 105, high: 112, low: 103, close: 108, volume: 200 },
      ];

      const merged = mergeHistoryBars(cached, external);
      expect(merged).toHaveLength(4);
      expect(merged.map((b) => b.time)).toEqual([
        "2026-02-28",
        "2026-03-01",
        "2026-03-02",
        "2026-03-03",
      ]);
    });
  });

  describe("calculateDataQuality & buildMonitoringSeries", () => {
    it("builds a complete monitoring series with correct metadata and data quality warnings", () => {
      const bars: MonitoringBar[] = [
        { time: "2026-03-01", open: 100, high: 105, low: 95, close: 100, volume: 100 },
        { time: "2026-03-02", open: null, high: null, low: null, close: 102, volume: null }, // incomplete OHLC
      ];

      const series = buildMonitoringSeries({
        instrumentId: "inst-1",
        ticker: "AAPL",
        label: "Apple Inc.",
        currency: "ARS",
        kind: "native",
        provider: "data912",
        source: "data912-eod",
        historyStatus: "cached",
        bars,
      });

      expect(series.ticker).toBe("AAPL");
      expect(series.bars).toHaveLength(2);
      expect(series.lastValue).toBe(102);
      expect(series.changePct).toBeCloseTo(2.0, 2);
      expect(series.dataQuality.missingOhlcBars).toBe(1);
      expect(series.dataQuality.warning).toContain("1 barras tienen OHLC incompleto");
    });
  });
});
