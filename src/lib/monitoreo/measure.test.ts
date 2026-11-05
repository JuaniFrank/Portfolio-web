import { describe, expect, it } from "vitest";
import { computeMeasure, formatMeasureLines } from "./measure";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const bars = Array.from({ length: 11 }, (_, i) => ({ timestamp: T0 + i * DAY, volume: 100 as number | null }));

describe("computeMeasure", () => {
  it("measures an upward move: bars A->B excluding A, calendar span, inclusive volume", () => {
    const m = computeMeasure({ timestamp: T0, value: 100 }, { timestamp: T0 + 10 * DAY, value: 112 }, bars);
    expect(m.direction).toBe("up");
    expect(m.priceChange).toBeCloseTo(12);
    expect(m.pricePct).toBeCloseTo(12);
    expect(m.barsCount).toBe(10);
    expect(m.spanDays).toBe(10);
    expect(m.volume).toBe(1100);
  });

  it("measures a downward move", () => {
    const m = computeMeasure({ timestamp: T0, value: 100 }, { timestamp: T0 + 4 * DAY, value: 90 }, bars);
    expect(m.direction).toBe("down");
    expect(m.priceChange).toBeCloseTo(-10);
    expect(m.pricePct).toBeCloseTo(-10);
    expect(m.barsCount).toBe(4);
  });

  it("handles B before A (reverse drag): values keep A->B sign, time stats are absolute", () => {
    const m = computeMeasure({ timestamp: T0 + 10 * DAY, value: 112 }, { timestamp: T0, value: 100 }, bars);
    expect(m.direction).toBe("down");
    expect(m.priceChange).toBeCloseTo(-12);
    expect(m.barsCount).toBe(10);
    expect(m.spanDays).toBe(10);
    expect(m.volume).toBe(1100);
  });

  it("handles equal points", () => {
    const m = computeMeasure({ timestamp: T0 + 2 * DAY, value: 50 }, { timestamp: T0 + 2 * DAY, value: 50 }, bars);
    expect(m.priceChange).toBe(0);
    expect(m.direction).toBe("up");
    expect(m.barsCount).toBe(0);
    expect(m.spanDays).toBe(0);
    expect(m.volume).toBe(100);
  });

  it("returns null pct when A is not positive", () => {
    const m = computeMeasure({ timestamp: T0, value: 0 }, { timestamp: T0 + DAY, value: 5 }, bars);
    expect(m.pricePct).toBeNull();
  });

  it("only counts bars inside the range when points fall outside the data", () => {
    const m = computeMeasure({ timestamp: T0 - 5 * DAY, value: 10 }, { timestamp: T0 + 100 * DAY, value: 20 }, bars);
    expect(m.barsCount).toBe(11);
    expect(m.spanDays).toBe(105);
    expect(m.volume).toBe(1100);
  });

  it("returns zero bars and null volume when no bar is in range", () => {
    const m = computeMeasure({ timestamp: T0 + 50 * DAY, value: 10 }, { timestamp: T0 + 60 * DAY, value: 11 }, bars);
    expect(m.barsCount).toBe(0);
    expect(m.volume).toBeNull();
  });

  it("returns null volume when the bars carry none", () => {
    const noVol = bars.map((b) => ({ timestamp: b.timestamp, volume: null }));
    expect(computeMeasure({ timestamp: T0, value: 1 }, { timestamp: T0 + 3 * DAY, value: 2 }, noVol).volume).toBeNull();
  });

  it("ignores missing volumes when summing", () => {
    const mixed = [
      { timestamp: T0, volume: 5 },
      { timestamp: T0 + DAY },
      { timestamp: T0 + 2 * DAY, volume: 7 },
    ];
    expect(computeMeasure({ timestamp: T0, value: 1 }, { timestamp: T0 + 2 * DAY, value: 2 }, mixed).volume).toBe(12);
  });
});

describe("formatMeasureLines", () => {
  const base = { priceChange: 3.2, pricePct: 12.4, barsCount: 15, spanDays: 21, volume: 123_400_000, direction: "up" as const };

  it("formats the three lines in es-AR with the series currency", () => {
    expect(formatMeasureLines(base, "USD")).toEqual(["+US$ 3,20 (+12,40%)", "15 velas, 21 d", "Vol 123,4M"]);
  });

  it("uses $ for ARS, a minus sign for drops and singular for one bar", () => {
    const lines = formatMeasureLines({ ...base, priceChange: -3.2, pricePct: -12.4, barsCount: 1, spanDays: 1, direction: "down" }, "ARS");
    expect(lines[0]).toBe("-$ 3,20 (-12,40%)");
    expect(lines[1]).toBe("1 vela, 1 d");
  });

  it("omits volume and percentage when unavailable", () => {
    const lines = formatMeasureLines({ ...base, pricePct: null, volume: null }, "USD");
    expect(lines).toEqual(["+US$ 3,20", "15 velas, 21 d"]);
  });
});
