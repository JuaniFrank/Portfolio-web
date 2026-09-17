import { describe, expect, it, vi } from "vitest";
import { resolveBondSchedule } from "./schedule-source";
import type { BondTermsForProjection, ProjectedFlow } from "./cashflows";

const TERMS: BondTermsForProjection = {
  faceValue: "100",
  currencyCode: "USD",
  rateType: "FIXED",
  couponRate: "0.075",
  couponFrequencyMonths: 6,
  issueDate: "2026-05-11",
  maturityDate: "2030-05-13",
  amortizationSchedule: [{ date: "2030-05-13", principalPct: 100 }],
  dayCountConvention: "ACT/365",
};

const STORED_SCHEDULE = {
  rows: [
    {
      paymentDate: "2026-11-11",
      capital: 0,
      interestRate: 7.5,
      interestAmount: 3.78,
      residualValue: 100,
      cashFlow: 3.78,
    },
  ],
};

describe("resolveBondSchedule (AD-14 precedence)", () => {
  it("uses the stored BondSchedule when present and never calls projectCashFlows", () => {
    const projectFn = vi.fn<() => ProjectedFlow[]>(() => []);
    const result = resolveBondSchedule(STORED_SCHEDULE, TERMS, new Date(), projectFn);

    expect(result).toEqual({ source: "docta-schedule", rows: STORED_SCHEDULE.rows });
    expect(projectFn).not.toHaveBeenCalled();
  });

  it("falls through to BondTerms + projectCashFlows when no BondSchedule row exists", () => {
    const fakeFlows: ProjectedFlow[] = [
      {
        date: "2027-05-11",
        amount: 3.75,
        t: 0.5,
        flowType: "COUPON",
        assumedRate: false,
        periodDays: 180,
      },
    ];
    const projectFn = vi.fn<() => ProjectedFlow[]>(() => fakeFlows);
    const result = resolveBondSchedule(null, TERMS, new Date(), projectFn);

    expect(result).toEqual({ source: "derived", flows: fakeFlows });
    expect(projectFn).toHaveBeenCalledTimes(1);
  });

  it("returns an empty/no-schedule result — not a throw — when both are absent", () => {
    const projectFn = vi.fn<() => ProjectedFlow[]>(() => []);
    const result = resolveBondSchedule(null, null, new Date(), projectFn);

    expect(result).toEqual({ source: "none" });
    expect(projectFn).not.toHaveBeenCalled();
  });
});
