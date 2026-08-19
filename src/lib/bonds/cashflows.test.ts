import { describe, expect, it } from "vitest";
import { scaleFlowsToHolding, type ProjectedFlow } from "./cashflows";

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
