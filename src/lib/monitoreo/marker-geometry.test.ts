import { describe, expect, it } from "vitest";
import { markerGeometry } from "./marker-geometry";

describe("markerGeometry", () => {
  it("renders a tick exactly one candle wide when the bar is very narrow", () => {
    const g = markerGeometry(2.4, "buy");
    expect(g.shape).toBe("tick");
    expect(g.width).toBeCloseTo(2.4);
    expect(g.height).toBeLessThanOrEqual(3);
    expect(g.ringWidth).toBe(0);
  });

  it("never makes a tick narrower than 1px", () => {
    expect(markerGeometry(0.2, "sell").width).toBe(1);
  });

  it("uses the candle body width as diameter, clamped to [4, 12]", () => {
    expect(markerGeometry(4, "buy").width).toBe(4);
    expect(markerGeometry(9, "buy").width).toBe(9);
    expect(markerGeometry(40, "buy").width).toBe(12);
  });

  it("drops the ring below ~6px and keeps a thin one above", () => {
    expect(markerGeometry(5, "buy").ringWidth).toBe(0);
    expect(markerGeometry(8, "buy").ringWidth).toBeGreaterThan(0);
    expect(markerGeometry(12, "buy").ringWidth).toBeLessThanOrEqual(1.5);
  });

  it("encodes side by shape for non-tick markers", () => {
    expect(markerGeometry(10, "buy").shape).toBe("triangle-up");
    expect(markerGeometry(10, "sell").shape).toBe("triangle-down");
  });

  it("keeps a comfortable invisible hit target", () => {
    expect(markerGeometry(2, "buy").hitSize).toBeGreaterThanOrEqual(12);
    expect(markerGeometry(12, "buy").hitSize).toBeGreaterThanOrEqual(12);
  });

  it("handles non-finite input as a tick", () => {
    expect(markerGeometry(Number.NaN, "buy").shape).toBe("tick");
  });
});
