import { describe, expect, it } from "vitest";
import type { BondCashflowEntry } from "@/lib/bonds/cashflows";
import type { UpcomingDividend } from "@/lib/dividends/types";
import { buildUpcomingIncome } from "./upcoming-income";

const TODAY = new Date("2026-06-01T00:00:00.000Z");

function bondEntry(
  ticker: string,
  currencyCode: string,
  flows: Array<{ date: string; amount: number; flowType: "COUPON" | "AMORTIZATION" }>
): BondCashflowEntry {
  return {
    ticker,
    currencyCode,
    flows: flows.map((f) => ({
      date: f.date,
      amount: f.amount,
      flowType: f.flowType,
      t: 0,
      assumedRate: false,
      periodDays: null,
    })),
  };
}

function dividend(
  ticker: string,
  estimatedDate: string,
  estimatedTotal: string,
  currencyCode: "ARS" | "USD" = "USD"
): UpcomingDividend {
  return {
    ticker,
    instrumentName: `${ticker} Inc.`,
    estimatedDate,
    estimatedAmountPerShare: estimatedTotal,
    quantity: "1",
    estimatedTotal,
    currencyCode,
    isEstimate: true,
  };
}

describe("buildUpcomingIncome", () => {
  it("devuelve vacío sin entradas", () => {
    const result = buildUpcomingIncome({
      bondEntries: [],
      dividendEstimates: [],
      cclRate: 1000,
      today: TODAY,
    });
    expect(result.rows).toEqual([]);
    expect(result.totals.d30).toEqual({ ars: "0.00", usd: "0.00" });
    expect(result.totals.d60).toEqual({ ars: "0.00", usd: "0.00" });
    expect(result.totals.d90).toEqual({ ars: "0.00", usd: "0.00" });
  });

  it("excluye flujos pasados", () => {
    const entries = [
      bondEntry("MCC3O", "USD", [
        { date: "2026-05-31T00:00:00.000Z", amount: 10, flowType: "COUPON" },
        { date: "2026-06-15T00:00:00.000Z", amount: 20, flowType: "COUPON" },
      ]),
    ];
    const result = buildUpcomingIncome({
      bondEntries: entries,
      dividendEstimates: [],
      cclRate: 1000,
      today: TODAY,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.date).toBe("2026-06-15");
  });

  it("mezcla cupón, amortización y dividendo estimado, ordenado por fecha y ticker", () => {
    const entries = [
      bondEntry("MCC3O", "USD", [
        { date: "2026-06-20T00:00:00.000Z", amount: 10, flowType: "COUPON" },
      ]),
      bondEntry("EAC4O", "ARS", [
        { date: "2026-06-20T00:00:00.000Z", amount: 5000, flowType: "AMORTIZATION" },
      ]),
    ];
    const dividends = [dividend("AAPL", "2026-06-10T00:00:00.000Z", "15.50", "USD")];

    const result = buildUpcomingIncome({
      bondEntries: entries,
      dividendEstimates: dividends,
      cclRate: 1000,
      today: TODAY,
    });

    expect(result.rows.map((r) => [r.date, r.ticker, r.kind, r.estimated])).toEqual([
      ["2026-06-10", "AAPL", "dividend", true],
      ["2026-06-20", "EAC4O", "amortization", false],
      ["2026-06-20", "MCC3O", "coupon", false],
    ]);
  });

  it("cupón y amortización de ON son siempre estimated: false; dividendo siempre true", () => {
    const entries = [
      bondEntry("MCC3O", "USD", [
        { date: "2026-06-05T00:00:00.000Z", amount: 10, flowType: "COUPON" },
      ]),
    ];
    const result = buildUpcomingIncome({
      bondEntries: entries,
      dividendEstimates: [dividend("AAPL", "2026-06-05T00:00:00.000Z", "5")],
      cclRate: 1000,
      today: TODAY,
    });
    const bondRow = result.rows.find((r) => r.ticker === "MCC3O")!;
    const dividendRow = result.rows.find((r) => r.ticker === "AAPL")!;
    expect(bondRow.estimated).toBe(false);
    expect(dividendRow.estimated).toBe(true);
  });

  it("convierte moneda nativa con CCL; sin CCL deja el lado no nativo en null", () => {
    const entries = [
      bondEntry("MCC3O", "USD", [
        { date: "2026-06-05T00:00:00.000Z", amount: 10, flowType: "COUPON" },
      ]),
    ];

    const withCcl = buildUpcomingIncome({
      bondEntries: entries,
      dividendEstimates: [],
      cclRate: 1000,
      today: TODAY,
    });
    expect(withCcl.rows[0]!.amountUsd).toBe("10.00");
    expect(withCcl.rows[0]!.amountArs).toBe("10000.00");

    const withoutCcl = buildUpcomingIncome({
      bondEntries: entries,
      dividendEstimates: [],
      cclRate: null,
      today: TODAY,
    });
    expect(withoutCcl.rows[0]!.amountUsd).toBe("10.00");
    expect(withoutCcl.rows[0]!.amountArs).toBeNull();
  });

  it("calcula totales de 30/60/90 días con límites exactos inclusive", () => {
    const entries = [
      bondEntry("A", "ARS", [
        { date: "2026-07-01T00:00:00.000Z", amount: 100, flowType: "COUPON" }, // day 30
        { date: "2026-07-31T00:00:00.000Z", amount: 200, flowType: "COUPON" }, // day 60
        { date: "2026-08-30T00:00:00.000Z", amount: 300, flowType: "COUPON" }, // day 90
        { date: "2026-08-31T00:00:00.000Z", amount: 400, flowType: "COUPON" }, // day 91 (fuera)
      ]),
    ];

    const result = buildUpcomingIncome({
      bondEntries: entries,
      dividendEstimates: [],
      cclRate: 1000,
      today: TODAY,
    });

    expect(result.rows.map((r) => r.daysUntil)).toEqual([30, 60, 90, 91]);
    expect(result.totals.d30.ars).toBe("100.00");
    expect(result.totals.d60.ars).toBe("300.00");
    expect(result.totals.d90.ars).toBe("600.00");
  });

  it("las filas quedan ordenadas por fecha y ticker (invariante de orden)", () => {
    const entries = [
      bondEntry("ZZZ", "ARS", [{ date: "2026-06-05T00:00:00.000Z", amount: 1, flowType: "COUPON" }]),
      bondEntry("AAA", "ARS", [{ date: "2026-06-05T00:00:00.000Z", amount: 1, flowType: "COUPON" }]),
    ];
    const result = buildUpcomingIncome({
      bondEntries: entries,
      dividendEstimates: [],
      cclRate: 1000,
      today: TODAY,
    });
    expect(result.rows.map((r) => r.ticker)).toEqual(["AAA", "ZZZ"]);
  });
});
