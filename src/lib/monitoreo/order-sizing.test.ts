import { describe, expect, it } from "vitest";
import { quantityForAmount, quantityForTargetAvgCost } from "./order-sizing";

describe("quantityForAmount", () => {
  it("buys whole units and reports the leftover", () => {
    expect(quantityForAmount(1000, 300, 0)).toEqual({ quantity: 3, spent: 900, leftover: 100 });
  });

  it("includes the commission in the unit cost of a buy", () => {
    const r = quantityForAmount(1000, 100, 1)!;
    // 101 per unit -> 9 units (909), leftover 91
    expect(r.quantity).toBe(9);
    expect(r.spent).toBeCloseTo(909, 6);
    expect(r.leftover).toBeCloseTo(91, 6);
  });

  it("sizes a sell by net proceeds per unit", () => {
    const r = quantityForAmount(1000, 100, 1, "sell")!;
    // 99 net per unit -> 10 units (990), leftover 10
    expect(r.quantity).toBe(10);
    expect(r.spent).toBeCloseTo(990, 6);
  });

  it("returns 0 units when the amount does not cover one", () => {
    expect(quantityForAmount(50, 100, 0)).toEqual({ quantity: 0, spent: 0, leftover: 50 });
  });

  it("does not lose a unit to floating point error", () => {
    expect(quantityForAmount(0.3, 0.1, 0)!.quantity).toBe(3);
  });

  it("returns null for invalid input", () => {
    expect(quantityForAmount(0, 100, 0)).toBeNull();
    expect(quantityForAmount(100, Number.NaN, 0)).toBeNull();
    expect(quantityForAmount(100, -1, 0)).toBeNull();
  });
});

describe("quantityForTargetAvgCost", () => {
  const holding = { quantity: 34, avgCost: 7301.91 };

  it("finds the whole units that bring the PPC to (or below) the target", () => {
    const r = quantityForTargetAvgCost(holding, 6773.07, 4975, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quantity).toBeGreaterThanOrEqual(10);
    expect(r.quantity).toBeLessThanOrEqual(11);
    expect(r.resultingAvgCost).toBeLessThanOrEqual(6773.07);
    // one unit fewer would not reach it
    const fewer = (34 * 7301.91 + (r.quantity - 1) * 4975) / (34 + r.quantity - 1);
    expect(fewer).toBeGreaterThan(6773.07);
  });

  it("accounts for the commission in the effective buy price", () => {
    const r = quantityForTargetAvgCost({ quantity: 10, avgCost: 100 }, 90, 80, 10);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // effective price 88 -> n = 10 * 10 / 2 = 50
    expect(r.quantity).toBe(50);
    expect(r.resultingAvgCost).toBeCloseTo(90, 6);
  });

  it("can raise the PPC when buying above it", () => {
    const r = quantityForTargetAvgCost({ quantity: 10, avgCost: 100 }, 110, 130, 0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quantity).toBe(5);
    expect(r.resultingAvgCost).toBeCloseTo(110, 6);
  });

  it("explains an unreachable target below the buy price", () => {
    expect(quantityForTargetAvgCost(holding, 4900, 4975, 0)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("explains a target that is not in the direction of the buy", () => {
    expect(quantityForTargetAvgCost(holding, 7500, 4975, 0)).toEqual({ ok: false, reason: "wrong-direction" });
    expect(quantityForTargetAvgCost({ quantity: 10, avgCost: 100 }, 90, 130, 0)).toEqual({
      ok: false,
      reason: "wrong-direction",
    });
  });

  it("reports a target equal to the current PPC as already met", () => {
    expect(quantityForTargetAvgCost(holding, 7301.91, 4975, 0)).toEqual({ ok: false, reason: "already-at-target" });
  });

  it("needs an open comparable position", () => {
    expect(quantityForTargetAvgCost(null, 90, 80, 0)).toEqual({ ok: false, reason: "no-position" });
    expect(quantityForTargetAvgCost({ quantity: 0, avgCost: null }, 90, 80, 0)).toEqual({
      ok: false,
      reason: "no-position",
    });
    expect(quantityForTargetAvgCost({ quantity: 5, avgCost: null }, 90, 80, 0)).toEqual({
      ok: false,
      reason: "not-comparable",
    });
  });

  it("rejects invalid numbers", () => {
    expect(quantityForTargetAvgCost(holding, Number.NaN, 80, 0)).toEqual({ ok: false, reason: "invalid" });
    expect(quantityForTargetAvgCost(holding, 90, 0, 0)).toEqual({ ok: false, reason: "invalid" });
  });
});
