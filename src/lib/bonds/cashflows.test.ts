import { describe, expect, it } from "vitest";
import {
  buildBondCashflowOutlook,
  buildCouponDates,
  computeCouponsYtd,
  projectCashFlows,
  scaleFlowsToHolding,
  type BondCashflowEntry,
  type BondTermsForProjection,
  type ProjectedFlow,
} from "./cashflows";

const baseFlow: ProjectedFlow = {
  date: "2027-03-10",
  flowType: "COUPON",
  amount: 36,
  t: 1.5,
  assumedRate: false,
  periodDays: 180,
};

describe("scaleFlowsToHolding", () => {
  it("escala el monto por la proporción nominalHeld/faceValue", () => {
    const scaled = scaleFlowsToHolding([baseFlow], "2000", "1000")[0]!;

    expect(scaled.amount).toBe(72);
  });

  it("no modifica el monto cuando nominalHeld === faceValue", () => {
    const scaled = scaleFlowsToHolding([baseFlow], "1000", "1000")[0]!;

    expect(scaled.amount).toBe(36);
  });

  it("preserva el resto de los campos del flujo sin modificarlos", () => {
    const scaled = scaleFlowsToHolding([baseFlow], "500", "1000")[0]!;

    expect(scaled.date).toBe(baseFlow.date);
    expect(scaled.flowType).toBe(baseFlow.flowType);
    expect(scaled.assumedRate).toBe(baseFlow.assumedRate);
    expect(scaled.periodDays).toBe(baseFlow.periodDays);
    expect(scaled.t).toBe(baseFlow.t);
    expect(scaled.amount).toBe(18);
  });

  it("escala tanto flujos de cupón como de amortización", () => {
    const amortFlow: ProjectedFlow = {
      ...baseFlow,
      flowType: "AMORTIZATION",
      amount: 1000,
      periodDays: null,
    };

    const scaled = scaleFlowsToHolding([amortFlow], "300", "1000")[0]!;

    expect(scaled.amount).toBe(300);
  });

  it("faceValue neutrality (T-29): projecting the same bond at faceValue=100 and faceValue=1000 yields identical scaled flows for the same nominalHeld — the property that makes AD-14's unconditional faceValue=100 auto-fill safe", () => {
    // projectCashFlows generates raw flows proportional to terms.faceValue
    // (e.g. couponRate × faceValue / periodsPerYear); scaleFlowsToHolding
    // then divides by that same faceValue. Every scaled amount is
    // homogeneous of degree 1 in faceValue, so it cancels exactly — the
    // basis is a labeling choice, not a fact about the bond.
    const baseTerms: BondTermsForProjection = {
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
    const today = new Date("2026-06-01T00:00:00.000Z");
    const nominalHeld = "250";

    const flowsAt100 = scaleFlowsToHolding(
      projectCashFlows(baseTerms, today),
      nominalHeld,
      baseTerms.faceValue
    );
    const termsAt1000 = { ...baseTerms, faceValue: "1000" };
    const flowsAt1000 = scaleFlowsToHolding(
      projectCashFlows(termsAt1000, today),
      nominalHeld,
      termsAt1000.faceValue
    );

    expect(flowsAt1000).toHaveLength(flowsAt100.length);
    flowsAt1000.forEach((flow, i) => {
      // Rounding-order differences in the Decimal chain (faceValue=1000
      // computes 10x-larger intermediate amounts before scaling back down)
      // introduce sub-cent floating noise — the property under test is
      // cancellation, not bit-identical output, so compare with a tight
      // cents-level tolerance.
      expect(flow.amount).toBeCloseTo(flowsAt100[i]!.amount, 6);
    });
  });
});

describe("buildBondCashflowOutlook", () => {
  const today = new Date("2026-08-19T00:00:00.000Z");

  it("agrupa por fecha el próximo pago, sumando entre tickers distintos y convirtiendo moneda", () => {
    const entries: BondCashflowEntry[] = [
      {
        ticker: "AL30",
        currencyCode: "USD",
        flows: [
          { date: "2026-08-25T00:00:00.000Z", flowType: "COUPON", amount: 50, t: 0.02, assumedRate: false, periodDays: 180 },
          { date: "2027-02-25T00:00:00.000Z", flowType: "COUPON", amount: 50, t: 0.52, assumedRate: false, periodDays: 180 },
        ],
      },
      {
        ticker: "GD30",
        currencyCode: "ARS",
        flows: [
          { date: "2026-08-25T00:00:00.000Z", flowType: "AMORTIZATION", amount: 100000, t: 0.02, assumedRate: false, periodDays: null },
        ],
      },
    ];

    const outlook = buildBondCashflowOutlook(entries, 1000, today);

    expect(outlook.nextPayment).not.toBeNull();
    expect(outlook.nextPayment?.date).toBe("2026-08-25");
    expect(outlook.nextPayment?.daysUntil).toBe(6);
    expect(outlook.nextPayment?.amountUsd).toBe("150.00");
    expect(outlook.nextPayment?.amountArs).toBe("150000.00");
    expect(outlook.nextPayment?.tickers).toEqual(["AL30", "GD30"]);
  });

  it("separa lo proyectado del año actual y del año siguiente", () => {
    const entries: BondCashflowEntry[] = [
      {
        ticker: "AL30",
        currencyCode: "USD",
        flows: [
          { date: "2026-08-25T00:00:00.000Z", flowType: "COUPON", amount: 50, t: 0.02, assumedRate: false, periodDays: 180 },
          { date: "2027-02-25T00:00:00.000Z", flowType: "COUPON", amount: 70, t: 0.52, assumedRate: false, periodDays: 180 },
        ],
      },
    ];

    const outlook = buildBondCashflowOutlook(entries, 1000, today);

    expect(outlook.currentYear).toBe(2026);
    expect(outlook.nextYear).toBe(2027);
    expect(outlook.projectedCurrentYearUsd).toBe("50.00");
    expect(outlook.projectedNextYearUsd).toBe("70.00");
    expect(outlook.projectedCurrentYearArs).toBe("50000.00");
    expect(outlook.projectedNextYearArs).toBe("70000.00");
  });

  it("devuelve un outlook vacío cuando no hay flujos", () => {
    const outlook = buildBondCashflowOutlook([], 1000, today);

    expect(outlook.nextPayment).toBeNull();
    expect(outlook.projectedCurrentYearUsd).toBe("0.00");
    expect(outlook.projectedNextYearUsd).toBe("0.00");
    expect(outlook.projectedCurrentYearArs).toBe("0.00");
    expect(outlook.projectedNextYearArs).toBe("0.00");
  });

  it("sin cotización CCL, omite la conversión de flujos en moneda distinta pero conserva la nativa", () => {
    const entries: BondCashflowEntry[] = [
      {
        ticker: "AL30",
        currencyCode: "USD",
        flows: [
          { date: "2026-08-25T00:00:00.000Z", flowType: "COUPON", amount: 50, t: 0.02, assumedRate: false, periodDays: 180 },
        ],
      },
    ];

    const outlook = buildBondCashflowOutlook(entries, null, today);

    expect(outlook.projectedCurrentYearUsd).toBe("50.00");
    expect(outlook.projectedCurrentYearArs).toBe("0.00");
  });
});

describe("computeCouponsYtd", () => {
  const thisYear = new Date().getUTCFullYear();
  const coupon = (amount: string, currencyCode: string) => ({
    ticker: "YMCJO",
    type: "COUPON" as const,
    date: `${thisYear}-03-10T12:00:00.000Z`,
    amount,
    currencyCode,
  });

  it("counts every USD code as dollars", () => {
    const total = computeCouponsYtd(
      [coupon("5", "USD"), coupon("5", "USD_MEP"), coupon("5", "USD_CABLE")],
      1000
    );
    expect(total).toBe("15.00");
  });

  it("converts ARS coupons at the given CCL", () => {
    expect(computeCouponsYtd([coupon("10000", "ARS")], 1000)).toBe("10.00");
  });
});

describe("projectCashFlows — amortization and coupon dates", () => {
  const terms: BondTermsForProjection = {
    faceValue: "100",
    currencyCode: "USD",
    rateType: "FIXED",
    couponRate: "0.10",
    couponFrequencyMonths: 6,
    issueDate: "2026-01-15",
    maturityDate: "2027-01-15",
    amortizationSchedule: [
      { date: "2026-07-15", principalPct: 50 },
      { date: "2027-01-15", principalPct: 50 },
    ],
    dayCountConvention: "30/360",
  };
  const today = new Date("2026-02-01T00:00:00.000Z");
  const flowsOn = (flows: ProjectedFlow[], date: string, type: ProjectedFlow["flowType"]) =>
    flows.filter((f) => f.date.startsWith(date) && f.flowType === type);

  it("accrues the coupon on principal at period start when an amortization lands on the coupon date", () => {
    const flows = projectCashFlows(terms, today);
    const [coupon] = flowsOn(flows, "2026-07-15", "COUPON");
    // 100 outstanding for the whole Jan-Jul period: 100 x 10% x 0.5 = 5.0 (not 2.5).
    expect(coupon!.amount).toBeCloseTo(5.0, 8);
    expect(flowsOn(flows, "2026-07-15", "AMORTIZATION")[0]!.amount).toBeCloseTo(50, 8);
  });

  it("keeps the last coupon when the final amortization lands on maturity", () => {
    const flows = projectCashFlows(terms, today);
    const [coupon] = flowsOn(flows, "2027-01-15", "COUPON");
    // The 50 left after July earns 50 x 10% x 0.5 = 2.5.
    expect(coupon).toBeDefined();
    expect(coupon!.amount).toBeCloseTo(2.5, 8);
    expect(flowsOn(flows, "2027-01-15", "AMORTIZATION")[0]!.amount).toBeCloseTo(50, 8);
  });

  it("splits accrual at a mid-period amortization", () => {
    const flows = projectCashFlows(
      { ...terms, amortizationSchedule: [{ date: "2026-04-15", principalPct: 50 }, { date: "2027-01-15", principalPct: 50 }] },
      today
    );
    // Jan15-Apr15 on 100 (2.5) + Apr15-Jul15 on 50 (1.25).
    expect(flowsOn(flows, "2026-07-15", "COUPON")[0]!.amount).toBeCloseTo(3.75, 8);
  });

  it("is unchanged for a bullet bond", () => {
    const flows = projectCashFlows(
      { ...terms, amortizationSchedule: [{ date: "2027-01-15", principalPct: 100 }] },
      today
    );
    expect(flowsOn(flows, "2026-07-15", "COUPON")[0]!.amount).toBeCloseTo(5.0, 8);
    expect(flowsOn(flows, "2027-01-15", "COUPON")[0]!.amount).toBeCloseTo(5.0, 8);
  });
});

describe("buildCouponDates", () => {
  const iso = (dates: Date[]) => dates.map((d) => d.toISOString().slice(0, 10));
  const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);

  it("anchors every date to the issue date instead of chaining month by month", () => {
    // Chained: Jan 31 -> Feb 28 -> Mar 28. Anchored: Mar 31.
    expect(iso(buildCouponDates(utc("2026-01-31"), utc("2026-05-31"), 1))).toEqual([
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  it("recovers the anchor day after a short month on a semiannual bond", () => {
    expect(iso(buildCouponDates(utc("2026-08-31"), utc("2027-08-31"), 6))).toEqual([
      "2027-02-28",
      "2027-08-31",
    ]);
  });

  it("appends maturity when it is not on the cadence", () => {
    expect(iso(buildCouponDates(utc("2026-01-15"), utc("2026-08-01"), 6))).toEqual([
      "2026-07-15",
      "2026-08-01",
    ]);
  });
});
