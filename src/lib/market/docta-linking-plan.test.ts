import { describe, expect, it } from "vitest";
import { planDoctaLinkingBatch, type FixedIncomeCandidate } from "./docta-linking-plan";

function candidate(
  ticker: string,
  isHeld: boolean,
  needsDoctaLookup = true
): FixedIncomeCandidate {
  return { ticker, isHeld, needsDoctaLookup };
}

describe("planDoctaLinkingBatch", () => {
  it("held candidates come before unheld candidates, regardless of input order", () => {
    const candidates = [
      candidate("UNHELD1", false),
      candidate("HELD1", true),
      candidate("UNHELD2", false),
      candidate("HELD2", true),
    ];
    const plan = planDoctaLinkingBatch(candidates, 10);
    expect(plan.map((c) => c.ticker)).toEqual(["HELD1", "HELD2", "UNHELD1", "UNHELD2"]);
  });

  it("preserves relative input order within the held group and within the unheld group", () => {
    const candidates = [
      candidate("H_B", true),
      candidate("U_B", false),
      candidate("H_A", true),
      candidate("U_A", false),
    ];
    const plan = planDoctaLinkingBatch(candidates, 10);
    expect(plan.map((c) => c.ticker)).toEqual(["H_B", "H_A", "U_B", "U_A"]);
  });

  it("never includes a candidate that does not need a Docta lookup (already resolved — has an ISIN or a cached definitive 404)", () => {
    const candidates = [
      candidate("HELD_RESOLVED", true, false),
      candidate("HELD_UNRESOLVED", true, true),
      candidate("UNHELD_UNRESOLVED", false, true),
    ];
    const plan = planDoctaLinkingBatch(candidates, 10);
    expect(plan.map((c) => c.ticker)).toEqual(["HELD_UNRESOLVED", "UNHELD_UNRESOLVED"]);
  });

  it("never returns more than the budget, prioritizing held candidates first when budget is tight", () => {
    const candidates = [
      candidate("UNHELD1", false),
      candidate("HELD1", true),
      candidate("HELD2", true),
      candidate("UNHELD2", false),
    ];
    const plan = planDoctaLinkingBatch(candidates, 1);
    expect(plan.map((c) => c.ticker)).toEqual(["HELD1"]);
  });

  it("fills remaining budget with unheld candidates once every held candidate is covered", () => {
    const candidates = [candidate("HELD1", true), candidate("UNHELD1", false), candidate("UNHELD2", false)];
    const plan = planDoctaLinkingBatch(candidates, 2);
    expect(plan.map((c) => c.ticker)).toEqual(["HELD1", "UNHELD1"]);
  });

  it("a budget of 0 returns an empty plan", () => {
    const candidates = [candidate("HELD1", true)];
    expect(planDoctaLinkingBatch(candidates, 0)).toEqual([]);
  });

  it("clamps a negative budget to 0 rather than throwing or returning everything", () => {
    const candidates = [candidate("HELD1", true)];
    expect(planDoctaLinkingBatch(candidates, -5)).toEqual([]);
  });

  it("a held candidate beyond the budget is deferred, not force-included", () => {
    const candidates = [candidate("HELD1", true), candidate("HELD2", true)];
    const plan = planDoctaLinkingBatch(candidates, 1);
    expect(plan.map((c) => c.ticker)).toEqual(["HELD1"]);
  });
});
