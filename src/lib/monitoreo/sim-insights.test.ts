import { describe, expect, it } from "vitest";
import { breakEvenMovePct, scenarioTable } from "./sim-insights";

describe("breakEvenMovePct", () => {
  it("is the rise from the reference price needed to reach the PPC", () => {
    expect(breakEvenMovePct(80, 100)).toBeCloseTo(25, 6);
  });

  it("is negative when the position is already in profit", () => {
    expect(breakEvenMovePct(120, 100)).toBeCloseTo(-16.6667, 3);
  });

  it("is null without a usable reference or PPC", () => {
    expect(breakEvenMovePct(0, 100)).toBeNull();
    expect(breakEvenMovePct(80, null)).toBeNull();
    expect(breakEvenMovePct(null, 100)).toBeNull();
    expect(breakEvenMovePct(Number.NaN, 100)).toBeNull();
  });
});

describe("scenarioTable", () => {
  const base = { amount: 1000, marketPrice: 100, factor: 1, moneyFactor: 1, feePct: 0 };

  it("prices each drop from the market price and averages the same amount into the PPC", () => {
    const rows = scenarioTable({ quantity: 10, avgCost: 100 }, { ...base, drops: [10, 20] })!;
    expect(rows.map((r) => r.price)).toEqual([90, 80]);
    // 1000 / 90 -> 11 units; PPC (1000 + 11*90) / 21
    expect(rows[0]).toMatchObject({ dropPct: 10, quantity: 11 });
    expect(rows[0]!.newAvgCost).toBeCloseTo((1000 + 990) / 21, 6);
    expect(rows[0]!.avgCostChangePct).toBeCloseTo(((1990 / 21 - 100) / 100) * 100, 6);
    expect(rows[0]!.resultPct).toBeCloseTo(((90 - 1990 / 21) / (1990 / 21)) * 100, 6);
    expect(rows[1]).toMatchObject({ quantity: 12 });
  });

  it("defaults to the -5/-10/-20/-30 ladder", () => {
    const rows = scenarioTable({ quantity: 10, avgCost: 100 }, base)!;
    expect(rows.map((r) => r.dropPct)).toEqual([5, 10, 20, 30]);
  });

  it("uses the buy price as PPC when nothing is held", () => {
    const rows = scenarioTable(null, { ...base, drops: [10] })!;
    expect(rows[0]!.newAvgCost).toBeCloseTo(90, 6);
    expect(rows[0]!.avgCostChangePct).toBeNull();
    expect(rows[0]!.resultPct).toBeCloseTo(0, 6);
  });

  it("includes the commission in the effective price", () => {
    const rows = scenarioTable(null, { ...base, drops: [0], feePct: 1 })!;
    expect(rows[0]!.quantity).toBe(9);
    expect(rows[0]!.newAvgCost).toBeCloseTo(101, 6);
  });

  it("converts the basis price to chart scale with the factor", () => {
    // the amount is in chart currency: 1.000.000 buys 11 units at 90.000
    const rows = scenarioTable(
      { quantity: 10, avgCost: 90000 },
      { ...base, amount: 1_000_000, marketPrice: 100, factor: 1000, drops: [10] }
    )!;
    expect(rows[0]!.price).toBeCloseTo(90000, 6);
    expect(rows[0]!.quantity).toBe(11);
    expect(rows[0]!.newAvgCost).toBeCloseTo(90000, 6);
  });

  it("sizes the amount in pesos per unit through the money factor", () => {
    // ADR 30 USD = 7000 ARS per share: 70.000 ARS buys 10 shares at 30, not 2.333
    const rows = scenarioTable(null, { ...base, amount: 70000, marketPrice: 30, moneyFactor: 7000 / 30, drops: [0] })!;
    expect(rows[0]!.quantity).toBe(10);
  });

  it("keeps the current PPC when the amount buys no whole unit", () => {
    const rows = scenarioTable({ quantity: 10, avgCost: 100 }, { ...base, amount: 50, drops: [10] })!;
    expect(rows[0]).toMatchObject({ quantity: 0, newAvgCost: 100, avgCostChangePct: 0 });
  });

  it("returns null without a money factor", () => {
    expect(scenarioTable(null, { ...base, moneyFactor: null })).toBeNull();
  });

  it("returns null for invalid inputs or a non-comparable position", () => {
    expect(scenarioTable({ quantity: 10, avgCost: null }, base)).toBeNull();
    expect(scenarioTable(null, { ...base, amount: 0 })).toBeNull();
    expect(scenarioTable(null, { ...base, marketPrice: Number.NaN })).toBeNull();
    expect(scenarioTable(null, { ...base, factor: 0 })).toBeNull();
  });
});
