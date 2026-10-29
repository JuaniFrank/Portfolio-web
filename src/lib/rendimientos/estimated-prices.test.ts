import { describe, expect, it } from "vitest";
import { monthsWithEstimatedPrices, estimatedMonthsInPeriod } from "./estimated-prices";

describe("monthsWithEstimatedPrices", () => {
  it("devuelve los meses cuyo cierre tiene alguna posición con precio estimado", () => {
    const result = monthsWithEstimatedPrices([
      { month: "2026-01", positions: [{ priceEstimated: false }, { priceEstimated: undefined }] },
      { month: "2026-02", positions: [{ priceEstimated: false }, { priceEstimated: true }] },
      { month: "2026-03", positions: [] },
    ]);

    expect(result).toEqual(["2026-02"]);
  });

  it("sin posiciones estimadas devuelve vacío", () => {
    expect(monthsWithEstimatedPrices([{ month: "2026-01", positions: [{}] }])).toEqual([]);
  });
});

describe("estimatedMonthsInPeriod", () => {
  it("deja solo los meses estimados que caen dentro del período visible", () => {
    const result = estimatedMonthsInPeriod(
      ["2026-01", "2026-02", "2026-04"],
      [{ month: "2026-02" }, { month: "2026-03" }, { month: "2026-04" }]
    );

    expect(result).toEqual(["2026-02", "2026-04"]);
  });

  it("período vacío no tiene meses estimados", () => {
    expect(estimatedMonthsInPeriod(["2026-01"], [])).toEqual([]);
  });
});
