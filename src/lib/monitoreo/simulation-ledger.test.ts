import { describe, expect, it } from "vitest";
import { applyOrder, runSimulation, type SimOrder } from "./simulation-ledger";

const buy = (id: string, quantity: number, price: number): SimOrder => ({ id, side: "buy", quantity, price });
const sell = (id: string, quantity: number, price: number): SimOrder => ({ id, side: "sell", quantity, price });
const held = (quantity: number, avgCost: number | null) => ({ quantity, avgCost });

describe("runSimulation", () => {
  it("averages a single buy into an open position (34 @ 7301.91 + 10 @ 4975)", () => {
    const r = runSimulation(held(34, 7301.91), [buy("a", 10, 4975)], { referencePrice: 5000 });
    expect(r).not.toBeNull();
    expect(r!.totals.quantity).toBe(44);
    expect(r!.totals.avgCost).toBeCloseTo(6773.0668, 4);
    expect(r!.totals.avgCostChange).toBeCloseTo(6773.0668 - 7301.91, 4);
    expect(r!.totals.avgCostChangePct).toBeCloseTo(((6773.0668 - 7301.91) / 7301.91) * 100, 3);
    expect(r!.totals.totalInvested).toBeCloseTo(49750, 6);
    expect(r!.totals.unrealizedPct).toBeCloseTo(((5000 - 6773.0668) / 6773.0668) * 100, 3);
  });

  it("applies buys in sequence and reports the PPC after each step", () => {
    const r = runSimulation(held(10, 100), [buy("a", 10, 80), buy("b", 20, 50)])!;
    expect(r.steps.map((s) => s.avgCostAfter)).toEqual([90, 70]);
    expect(r.steps.map((s) => s.quantityAfter)).toEqual([20, 40]);
    expect(r.totals.avgCost).toBe(70);
  });

  it("starts from the buy price when there is no open position", () => {
    const r = runSimulation(null, [buy("a", 5, 100)], { referencePrice: 110 })!;
    expect(r.totals).toMatchObject({ quantity: 5, avgCost: 100, avgCostChange: 0, totalInvested: 500 });
    expect(r.totals.avgCostChangePct).toBeNull();
    expect(r.totals.unrealizedPct).toBeCloseTo(10, 6);
  });

  it("a sell reduces quantity at the current PPC and books the realized result", () => {
    const r = runSimulation(held(10, 100), [sell("s", 4, 130)])!;
    expect(r.steps[0]).toMatchObject({ quantityAfter: 6, avgCostAfter: 100, realized: 120, clamped: false });
    expect(r.totals).toMatchObject({ quantity: 6, avgCost: 100, totalProceeds: 520, totalRealized: 120 });
    expect(r.totals.avgCostChange).toBe(0);
  });

  it("clamps a sell larger than the holding and flags it", () => {
    const r = runSimulation(held(5, 100), [sell("s", 8, 90)])!;
    expect(r.steps[0]).toMatchObject({ quantity: 5, clamped: true, quantityAfter: 0, realized: -50 });
    expect(r.totals.clamped).toBe(true);
  });

  it("closing the position resets the PPC, so a later buy re-bases it", () => {
    const r = runSimulation(held(5, 100), [sell("s", 5, 120), buy("b", 2, 60)])!;
    expect(r.steps[0]!.avgCostAfter).toBeNull();
    expect(r.totals).toMatchObject({ quantity: 2, avgCost: 60 });
  });

  it("selling everything leaves no PPC and no unrealized result", () => {
    const r = runSimulation(held(5, 100), [sell("s", 5, 120)], { referencePrice: 150 })!;
    expect(r.totals).toMatchObject({ quantity: 0, avgCost: null, avgCostChange: 0, unrealizedPct: null });
    expect(r.totals.avgCostChangePct).toBeNull();
  });

  it("charges the commission on buys (effective price) and sells (net proceeds)", () => {
    const r = runSimulation(held(10, 100), [buy("b", 10, 100), sell("s", 10, 200)], { feePct: 1 })!;
    // buy: effective 101 -> PPC (10*100 + 10*101) / 20 = 100.5
    expect(r.steps[0]!.avgCostAfter).toBeCloseTo(100.5, 6);
    expect(r.steps[0]).toMatchObject({ fee: 10 });
    expect(r.steps[0]!.cash).toBeCloseTo(1010, 6);
    // sell: net 198, realized (198 - 100.5) * 10
    expect(r.steps[1]!.realized).toBeCloseTo(975, 6);
    expect(r.steps[1]!.cash).toBeCloseTo(1980, 6);
    expect(r.totals.totalFees).toBeCloseTo(30, 6);
    expect(r.totals.totalInvested).toBeCloseTo(1010, 6);
    expect(r.totals.totalProceeds).toBeCloseTo(1980, 6);
  });

  it("ignores invalid orders and returns null when none is valid", () => {
    expect(runSimulation(held(10, 100), [buy("a", 0, 10), buy("b", 5, Number.NaN)])).toBeNull();
    const r = runSimulation(held(10, 100), [buy("a", 0, 10), buy("b", 10, 80)])!;
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]!.orderId).toBe("b");
  });

  it("returns null for an open position whose PPC is not comparable", () => {
    expect(runSimulation(held(10, null), [buy("a", 1, 10)])).toBeNull();
  });

  it("treats a negative or non-finite commission as zero", () => {
    const r = runSimulation(null, [buy("a", 1, 100)], { feePct: -3 })!;
    expect(r.totals.totalFees).toBe(0);
    expect(r.totals.avgCost).toBe(100);
  });
});

describe("runSimulation money factor", () => {
  // ADR view: chart price 30 USD, 7000 ARS per local share -> 70.000 ARS for 10 shares, not 300
  const mf = 7000 / 30;

  it("scales every money figure but leaves PPC and percentages in chart scale", () => {
    const r = runSimulation(held(10, 30), [buy("b", 10, 30), sell("s", 5, 36)], {
      feePct: 1,
      moneyFactor: mf,
      referencePrice: 33,
    })!;
    expect(r.steps[0]!.avgCostAfter).toBeCloseTo(30.15, 6);
    expect(r.steps[0]!.cash).toBeCloseTo(10 * 30.3 * mf, 4);
    expect(r.totals.totalInvested).toBeCloseTo(70700, 3);
    expect(r.totals.totalFees).toBeCloseTo((3 + 1.8) * mf, 4);
    expect(r.steps[1]!.realized).toBeCloseTo((36 * 0.99 - 30.15) * 5 * mf, 4);
    expect(r.totals.totalProceeds).toBeCloseTo(5 * 36 * 0.99 * mf, 4);
    expect(r.totals.unrealizedPct).toBeCloseTo(((33 - 30.15) / 30.15) * 100, 6);
  });
});

describe("applyOrder", () => {
  it("is the single step the simulation folds over", () => {
    const step = applyOrder(held(10, 100), buy("a", 10, 80), 0);
    expect(step).toMatchObject({ quantityAfter: 20, avgCostAfter: 90 });
  });
});
