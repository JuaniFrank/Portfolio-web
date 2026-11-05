import { describe, expect, it } from "vitest";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import {
  adjustMonitoringBars,
  adjustmentFactorAfter,
  adjustmentModeForSource,
  adjustmentPolicyLabel,
  resolveSeriesAdjustment,
  resolveTradeAdjustment,
  underlyingSplitSymbol,
  splitsToEvents,
  toAdjustmentEvents,
} from "./split-adjustment";
import type { MonitoringBar } from "./types";

function bar(time: string, close: number, volume: number | null = 100): MonitoringBar {
  return { time, open: close, high: close + 1, low: close - 1, close, volume };
}

function event(
  effectiveDate: string,
  numerator: string,
  denominator: string,
  eventType: CorporateEventForBuilder["eventType"] = "STOCK_SPLIT"
): CorporateEventForBuilder {
  return { instrumentId: "i1", eventType, effectiveDate, numerator, denominator };
}

const bars = [bar("2026-05-27", 300), bar("2026-05-28", 303), bar("2026-05-29", 101)];
const split3 = event("2026-05-29", "3", "1");

describe("monitoreo/split-adjustment", () => {
  describe("adjustmentModeForSource", () => {
    it("maps each stored source to its adjustment rule", () => {
      expect(adjustmentModeForSource("data912-eod")).toBe("instrument-events");
      expect(adjustmentModeForSource("data912-live")).toBe("instrument-events");
      expect(adjustmentModeForSource("fmp-eod")).toBe("underlying-splits");
      expect(adjustmentModeForSource("yahoo-eod")).toBe("provider");
      expect(adjustmentModeForSource("yahoo-underlying-eod")).toBe("provider");
      expect(adjustmentModeForSource("cedear-theoretical")).toBe("none");
    });
  });

  describe("adjustMonitoringBars", () => {
    it("divides OHLC of bars strictly before the event and keeps volume", () => {
      const out = adjustMonitoringBars(bars, [split3]);
      expect(out[0]).toMatchObject({ time: "2026-05-27", open: 100, close: 100, volume: 100 });
      expect(out[0]!.high).toBeCloseTo(301 / 3, 9);
      expect(out[0]!.low).toBeCloseTo(299 / 3, 9);
      expect(out[1]!.close).toBe(101);
      expect(out[2]).toEqual(bars[2]);
    });

    it("returns the same bars without events and does not mutate the input", () => {
      expect(adjustMonitoringBars(bars, [])).toBe(bars);
      adjustMonitoringBars(bars, [split3]);
      expect(bars[0]!.close).toBe(300);
    });

    it("keeps null OHLC fields null", () => {
      const out = adjustMonitoringBars([{ ...bar("2026-05-27", 300), open: null, high: null, low: null }], [split3]);
      expect(out[0]).toMatchObject({ open: null, high: null, low: null, close: 100 });
    });
  });

  describe("toAdjustmentEvents / adjustmentFactorAfter", () => {
    it("drops TICKER_CHANGE and degenerate events", () => {
      const out = toAdjustmentEvents([
        split3,
        event("2026-06-01", "1", "1", "TICKER_CHANGE"),
        event("2026-06-02", "2", "0"),
        event("2026-06-03", "0", "1"),
      ]);
      expect(out).toEqual([{ effectiveDate: "2026-05-29", ratio: 3 }]);
    });

    it("multiplies ratios of events strictly after the date (same rule as applyEventsToTrade)", () => {
      const events = [
        { effectiveDate: "2026-05-29", ratio: 3 },
        { effectiveDate: "2026-08-01", ratio: 2 },
      ];
      expect(adjustmentFactorAfter("2026-05-01", events)).toBe(6);
      expect(adjustmentFactorAfter("2026-05-29", events)).toBe(2); // same-day is post-event
      expect(adjustmentFactorAfter("2026-08-01", events)).toBe(1);
    });
  });

  describe("splitsToEvents", () => {
    it("converts a forward split and a reverse split", () => {
      const out = splitsToEvents([
        { date: "2026-05-29", numerator: 3, denominator: 1 },
        { date: "2026-07-01", numerator: 1, denominator: 10 },
      ]);
      expect(out.map((e) => [e.effectiveDate, e.eventType, e.numerator, e.denominator])).toEqual([
        ["2026-05-29", "STOCK_SPLIT", "3", "1"],
        ["2026-07-01", "REVERSE_SPLIT", "1", "10"],
      ]);
    });
  });

  describe("resolveSeriesAdjustment", () => {
    const base = { bars, instrumentEvents: [split3], underlyingSplits: null };

    it("adjusts data912 bars with the instrument's events", () => {
      const r = resolveSeriesAdjustment({ ...base, source: "data912-eod", enabled: true, adjusted: true });
      expect(r.policy).toBe("split-adjusted");
      expect(r.bars[0]!.close).toBe(100);
      expect(r.events).toEqual([{ effectiveDate: "2026-05-29", ratio: 3 }]);
      expect(r.warning).toBeNull();
    });

    it("adjusts fmp bars with the underlying's splits, not the instrument events", () => {
      const r = resolveSeriesAdjustment({
        ...base,
        source: "fmp-eod",
        enabled: true,
        adjusted: true,
        underlyingSplits: [{ date: "2026-05-29", numerator: 2, denominator: 1 }],
      });
      expect(r.policy).toBe("split-adjusted");
      expect(r.bars[0]!.close).toBe(150);
      expect(r.events).toEqual([{ effectiveDate: "2026-05-29", ratio: 2 }]);
    });

    it("serves fmp raw with a warning when the splits could not be fetched", () => {
      const r = resolveSeriesAdjustment({ ...base, source: "fmp-eod", enabled: true, adjusted: true });
      expect(r.policy).toBe("raw");
      expect(r.bars).toBe(bars);
      expect(r.events).toEqual([]);
      expect(r.warning).toMatch(/splits/i);
    });

    it("never touches provider-adjusted sources (no double adjustment)", () => {
      for (const source of ["yahoo-eod", "yahoo-underlying-eod"]) {
        const r = resolveSeriesAdjustment({ ...base, source, enabled: true, adjusted: true });
        expect(r.policy).toBe("provider-adjusted");
        expect(r.bars).toBe(bars);
        expect(r.events).toEqual([]);
      }
    });

    it("serves raw bars when the user asks for unadjusted, except provider sources which stay provider-adjusted", () => {
      expect(resolveSeriesAdjustment({ ...base, source: "data912-eod", enabled: true, adjusted: false })).toMatchObject({
        policy: "raw",
        bars,
        events: [],
      });
      expect(resolveSeriesAdjustment({ ...base, source: "yahoo-eod", enabled: true, adjusted: false }).policy).toBe(
        "provider-adjusted"
      );
    });

    it("kill switch off: always the legacy raw behavior", () => {
      for (const source of ["data912-eod", "fmp-eod", "yahoo-eod"]) {
        const r = resolveSeriesAdjustment({ ...base, source, enabled: false, adjusted: true });
        expect(r).toEqual({ bars, policy: "raw", events: [], warning: null });
      }
    });

    it("leaves unknown sources raw", () => {
      const r = resolveSeriesAdjustment({ ...base, source: "cedear-theoretical", enabled: true, adjusted: true });
      expect(r.policy).toBe("raw");
    });
  });

  describe("resolveTradeAdjustment", () => {
    const corporateEvents = [{ effectiveDate: "2026-05-29", ratio: 3 }];
    const tradeData = { corporateEvents, corporateEventDates: ["2026-05-29", "2026-06-01"] };
    const seriesEvents = [{ effectiveDate: "2026-05-29", ratio: 2 }];

    it("split-adjusted series uses the events that were applied to its bars; gating off", () => {
      expect(
        resolveTradeAdjustment({ adjustmentPolicy: "split-adjusted", adjustmentEvents: seriesEvents }, tradeData)
      ).toEqual({ adjustmentEvents: seriesEvents, gatingEventDates: [] });
    });

    it("provider-adjusted series keeps the legacy gating (the provider's rewrite may not match our events)", () => {
      expect(
        resolveTradeAdjustment({ adjustmentPolicy: "provider-adjusted", adjustmentEvents: [] }, tradeData)
      ).toEqual({ adjustmentEvents: undefined, gatingEventDates: ["2026-05-29", "2026-06-01"] });
    });

    it("raw series keeps the legacy gating on the corporate event dates", () => {
      expect(
        resolveTradeAdjustment({ adjustmentPolicy: "raw", adjustmentEvents: [] }, tradeData)
      ).toEqual({ adjustmentEvents: undefined, gatingEventDates: ["2026-05-29", "2026-06-01"] });
    });
  });

  describe("underlyingSplitSymbol", () => {
    it("uses the underlying ticker for a CEDEAR and the own ticker otherwise", () => {
      expect(underlyingSplitSymbol({ type: "CEDEAR", ticker: "AAPL", underlyingAsset: { ticker: "AAPL.US" } })).toBe("AAPL.US");
      expect(underlyingSplitSymbol({ type: "CEDEAR", ticker: "AAPL", underlyingAsset: null })).toBe("AAPL");
      expect(underlyingSplitSymbol({ type: "STOCK_US", ticker: "MSFT", underlyingAsset: { ticker: "X" } })).toBe("MSFT");
    });
  });

  describe("adjustmentPolicyLabel", () => {
    it("is truthful per policy", () => {
      expect(adjustmentPolicyLabel("raw")).toBe("sin ajustar");
      expect(adjustmentPolicyLabel("split-adjusted")).toBe("ajustado por splits");
      expect(adjustmentPolicyLabel("provider-adjusted")).toBe("ajustado por el proveedor");
    });
  });
});
