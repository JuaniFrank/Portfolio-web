import { describe, expect, it } from "vitest";
import {
  buildBondCashflowOutlook,
  scaleFlowsToHolding,
  type BondCashflowEntry,
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
