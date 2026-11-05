import { describe, expect, it } from "vitest";
import { buildHeaderStats } from "./asset-stats";
import type { MonitoringBar } from "./types";

const bar = (time: string, close: number, high?: number, low?: number): MonitoringBar => ({
  time,
  open: close,
  high: high ?? close,
  low: low ?? close,
  close,
  volume: null,
});

describe("buildHeaderStats", () => {
  const all = [
    bar("2026-01-01", 100, 105, 95),
    bar("2026-02-01", 120, 130, 110),
    bar("2026-03-01", 110, 125, 108),
    bar("2026-03-02", 121, 122, 109),
  ];

  it("returns nulls for an empty series", () => {
    const s = buildHeaderStats([], []);
    expect(s.lastPrice).toBeNull();
    expect(s.dayChangePct).toBeNull();
    expect(s.rangeChangePct).toBeNull();
    expect(s.rangeHigh).toBeNull();
    expect(s.rangeLow).toBeNull();
  });

  it("computes last price and change vs previous bar from the full series", () => {
    const s = buildHeaderStats(all, all.slice(3));
    expect(s.lastPrice).toBe(121);
    expect(s.lastDate).toBe("2026-03-02");
    expect(s.dayChangeAbs).toBeCloseTo(11);
    expect(s.dayChangePct).toBeCloseTo(10);
  });

  it("computes range change from the first displayed close", () => {
    const s = buildHeaderStats(all, all.slice(1));
    expect(s.rangeChangePct).toBeCloseTo(((121 - 120) / 120) * 100);
  });

  it("uses high/low (falling back to close) over the displayed range only", () => {
    const s = buildHeaderStats(all, all.slice(1));
    expect(s.rangeHigh).toBe(130);
    expect(s.rangeLow).toBe(108);
  });

  it("has no day change with a single bar", () => {
    const one = [bar("2026-03-02", 50)];
    const s = buildHeaderStats(one, one);
    expect(s.lastPrice).toBe(50);
    expect(s.dayChangeAbs).toBeNull();
    expect(s.dayChangePct).toBeNull();
    expect(s.rangeChangePct).toBeNull();
  });
});
