import { describe, expect, it } from "vitest";
import { isSeriesAdjusted, projectTradePrice, type TradeProjectionContext } from "./trade-projection";
import type { MonitoringBar } from "./types";

function bar(time: string, close: number): MonitoringBar {
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

const baseCtx: TradeProjectionContext = {
  kind: "native",
  currency: "ARS",
  bars: [],
  nativeArsCloses: [],
  cclByDate: [],
};

const arsTrade = { tradeDate: "2026-03-09", price: 1000, currencyCode: "ARS" };
const usdTrade = { tradeDate: "2026-03-09", price: 10, currencyCode: "USD" };

describe("monitoreo/trade-projection", () => {
  describe("native", () => {
    it("returns the trade price when currencies match", () => {
      expect(projectTradePrice(arsTrade, baseCtx)).toEqual({ chartPrice: 1000, method: "direct" });
      expect(projectTradePrice(usdTrade, { ...baseCtx, currency: "USD" })).toEqual({
        chartPrice: 10,
        method: "direct",
      });
    });

    it("multiplies a USD trade by the CCL as-of the trade date on an ARS series", () => {
      const ctx = {
        ...baseCtx,
        cclByDate: [
          { date: "2026-03-06", rate: 1100 },
          { date: "2026-03-10", rate: 1200 },
        ],
      };
      expect(projectTradePrice(usdTrade, ctx)).toEqual({ chartPrice: 11000, method: "ccl" });
    });

    it("divides an ARS trade by the CCL on a USD series", () => {
      const ctx = { ...baseCtx, currency: "USD" as const, cclByDate: [{ date: "2026-03-09", rate: 1000 }] };
      expect(projectTradePrice(arsTrade, ctx)).toEqual({ chartPrice: 1, method: "ccl" });
    });

    it("returns null when CCL is missing or the CCL lookback is exceeded", () => {
      expect(projectTradePrice(usdTrade, baseCtx)).toEqual({ chartPrice: null, method: null });
      const stale = { ...baseCtx, cclByDate: [{ date: "2026-02-20", rate: 1100 }] };
      expect(projectTradePrice(usdTrade, stale)).toEqual({ chartPrice: null, method: null });
    });

    it("returns null for non-positive price", () => {
      expect(projectTradePrice({ ...arsTrade, price: 0 }, baseCtx)).toEqual({
        chartPrice: null,
        method: null,
      });
    });
  });

  describe("cedear-underlying", () => {
    const ctx: TradeProjectionContext = {
      kind: "cedear-underlying",
      currency: "USD",
      bars: [bar("2026-03-06", 200), bar("2026-03-09", 220)],
      nativeArsCloses: [
        { date: "2026-03-06", close: 20000 },
        { date: "2026-03-09", close: 22000 },
      ],
      cclByDate: [{ date: "2026-03-09", rate: 1000 }],
    };

    it("scales the ARS price by underlying/cedear closes on an exact-date hit", () => {
      // 11000 * (220 / 22000) = 110
      const r = projectTradePrice({ ...arsTrade, price: 11000 }, ctx);
      expect(r.method).toBe("underlying-factor");
      expect(r.chartPrice).toBeCloseTo(110, 8);
    });

    it("uses the latest earlier bars for a weekend trade date", () => {
      const r = projectTradePrice({ tradeDate: "2026-03-08", price: 10000, currencyCode: "ARS" }, ctx);
      // factor from 03-06: 200/20000 = 0.01 -> 100
      expect(r.chartPrice).toBeCloseTo(100, 8);
    });

    it("returns null beyond the 5-day lookback", () => {
      const r = projectTradePrice({ tradeDate: "2026-03-15", price: 10000, currencyCode: "ARS" }, ctx);
      expect(r).toEqual({ chartPrice: null, method: null });
    });

    it("converts a USD trade to ARS with CCL first", () => {
      // 10 USD * 1000 = 10000 ARS; * 0.01 = 100
      const r = projectTradePrice(usdTrade, ctx);
      expect(r.method).toBe("underlying-factor");
      expect(r.chartPrice).toBeCloseTo(100, 8);
    });

    it("returns null for a USD trade when CCL is missing", () => {
      expect(projectTradePrice(usdTrade, { ...ctx, cclByDate: [] })).toEqual({
        chartPrice: null,
        method: null,
      });
    });

    it("returns null when a close is zero", () => {
      const zeroCedear = { ...ctx, nativeArsCloses: [{ date: "2026-03-09", close: 0 }] };
      expect(projectTradePrice(arsTrade, zeroCedear)).toEqual({ chartPrice: null, method: null });
      const zeroUnderlying = { ...ctx, bars: [bar("2026-03-09", 0)] };
      expect(projectTradePrice(arsTrade, zeroUnderlying)).toEqual({ chartPrice: null, method: null });
    });

    it("returns null when the cedear ARS closes are missing", () => {
      expect(projectTradePrice(arsTrade, { ...ctx, nativeArsCloses: [] })).toEqual({
        chartPrice: null,
        method: null,
      });
    });
  });

  it("returns null for cedear-theoretical", () => {
    expect(projectTradePrice(arsTrade, { ...baseCtx, kind: "cedear-theoretical" })).toEqual({
      chartPrice: null,
      method: null,
    });
  });

  describe("adjusted displayed series", () => {
    const adjusted = { ...baseCtx, seriesAdjusted: true, corporateEventDates: ["2026-04-01"] };

    it("returns null for a native trade followed by a corporate event on an adjusted series", () => {
      expect(projectTradePrice(arsTrade, adjusted)).toEqual({ chartPrice: null, method: null });
    });

    it("keeps the direct price when the event is not after the trade, or the series is raw", () => {
      const before = { ...adjusted, corporateEventDates: ["2026-03-09"] };
      expect(projectTradePrice(arsTrade, before)).toEqual({ chartPrice: 1000, method: "direct" });
      const raw = { ...adjusted, seriesAdjusted: false };
      expect(projectTradePrice(arsTrade, raw)).toEqual({ chartPrice: 1000, method: "direct" });
    });
  });

  describe("isSeriesAdjusted", () => {
    it("flags split-adjusted policies and the yahoo-eod source", () => {
      expect(isSeriesAdjusted({ source: "yahoo-eod", adjustmentPolicy: "raw" })).toBe(true);
      expect(isSeriesAdjusted({ source: "x", adjustmentPolicy: "split-adjusted" })).toBe(true);
      expect(isSeriesAdjusted({ source: "data912-eod", adjustmentPolicy: "raw" })).toBe(false);
    });
  });
});

describe("monitoreo/trade-projection with adjustment events", () => {
  const events = [{ effectiveDate: "2026-04-01", ratio: 3 }];
  const ctx: TradeProjectionContext = {
    kind: "native",
    currency: "ARS",
    bars: [],
    nativeArsCloses: [],
    cclByDate: [{ date: "2026-03-09", rate: 1000 }],
    adjustmentEvents: events,
    // would block the trade under the legacy gating
    seriesAdjusted: true,
    corporateEventDates: ["2026-04-01"],
  };
  const trade = { tradeDate: "2026-03-09", price: 900, currencyCode: "ARS" };

  it("divides the trade price by the ratio of later events instead of blocking", () => {
    expect(projectTradePrice(trade, ctx)).toEqual({ chartPrice: 300, method: "direct" });
  });

  it("leaves trades on or after the event untouched", () => {
    expect(projectTradePrice({ ...trade, tradeDate: "2026-04-01" }, ctx)).toEqual({
      chartPrice: 900,
      method: "direct",
    });
  });

  it("adjusts before converting currency", () => {
    expect(projectTradePrice({ ...trade, price: 9, currencyCode: "USD" }, ctx)).toEqual({
      chartPrice: 3000,
      method: "ccl",
    });
  });

  it("without adjustment events the legacy gating still applies", () => {
    expect(projectTradePrice(trade, { ...ctx, adjustmentEvents: undefined })).toEqual({
      chartPrice: null,
      method: null,
    });
  });
});
