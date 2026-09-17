import { describe, expect, it } from "vitest";
import { planEquityProfileDrip, type EquityProfileCandidate } from "./equity-profile-drip-plan";

function candidate(ticker: string, isHeld = false): EquityProfileCandidate {
  return { ticker, isHeld };
}

describe("planEquityProfileDrip", () => {
  it("excludes held instruments — they are already covered by enrichUsedInstruments this run", () => {
    const candidates = [candidate("AAPL", true), candidate("MSFT", false)];
    const plan = planEquityProfileDrip(candidates, 10);
    expect(plan.map((c) => c.ticker)).toEqual(["MSFT"]);
  });

  it("orders alphabetically by ticker, regardless of input order", () => {
    const candidates = [candidate("MSFT"), candidate("AAPL"), candidate("GOOGL")];
    const plan = planEquityProfileDrip(candidates, 10);
    expect(plan.map((c) => c.ticker)).toEqual(["AAPL", "GOOGL", "MSFT"]);
  });

  it("never returns more than the limit", () => {
    const candidates = [candidate("AAPL"), candidate("MSFT"), candidate("GOOGL")];
    const plan = planEquityProfileDrip(candidates, 2);
    expect(plan).toHaveLength(2);
    expect(plan.map((c) => c.ticker)).toEqual(["AAPL", "GOOGL"]);
  });

  it("a limit of 0 returns an empty plan", () => {
    expect(planEquityProfileDrip([candidate("AAPL")], 0)).toEqual([]);
  });

  it("clamps a negative limit to 0 rather than throwing or returning everything", () => {
    expect(planEquityProfileDrip([candidate("AAPL")], -5)).toEqual([]);
  });
});
