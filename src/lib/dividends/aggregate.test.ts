import { describe, expect, it } from "vitest";
import { aggregateReceivedDividends } from "./aggregate";

const instrument = { id: "i1", ticker: "AAPL", type: "CEDEAR" as const, name: "Apple" };
const day = new Date("2026-04-10T12:00:00.000Z");

function dividend(id: string, amount: string, currencyCode = "USD") {
  return {
    id,
    type: "DIVIDEND_CASH" as const,
    tradeDate: day,
    quantity: { toString: () => "10" },
    netAmount: { toString: () => amount },
    currencyCode,
    brokerFxRate: null,
    notes: null,
    instrument,
  };
}

function withholding(id: string, amount: string, currencyCode = "ARS") {
  return { ...dividend(id, amount, currencyCode), type: "TAX_WITHHOLDING" as const };
}

describe("aggregateReceivedDividends", () => {
  it.each(["USD_MEP", "USD_CABLE", "USDT", "USDC", "usd"])(
    "treats %s dividends as USD",
    (code) => {
      const [row] = aggregateReceivedDividends([dividend("d1", "50", code)]);
      expect(row!.currencyCode).toBe("USD");
      expect(row!.grossUsd).toBe("50.00");
      expect(row!.grossArs).toBe("0.00");
    }
  );

  it("matches a withholding to its dividend", () => {
    const [row] = aggregateReceivedDividends([dividend("d1", "50"), withholding("t1", "1200")]);
    expect(row!.taxArs).toBe("1200.00");
  });

  it("consumes a withholding bucket once when several dividends share ticker and date", () => {
    // Two payments the same day, one 1200 ARS withholding: the total tax must stay 1200.
    const rows = aggregateReceivedDividends([
      dividend("d1", "50"),
      dividend("d2", "50"),
      withholding("t1", "1200"),
    ]);
    const totalTax = rows.reduce((sum, r) => sum + Number(r.taxArs), 0);
    expect(totalTax).toBe(1200);
    expect(rows.map((r) => r.taxArs)).toEqual(["600.00", "600.00"]);
  });

  it("splits the bucket in proportion to gross", () => {
    const rows = aggregateReceivedDividends([
      dividend("d1", "30"),
      dividend("d2", "10"),
      withholding("t1", "400"),
    ]);
    expect(rows.map((r) => r.taxArs)).toEqual(["300.00", "100.00"]);
  });

  it("keeps the full bucket on a lone dividend (no behavior change)", () => {
    const [row] = aggregateReceivedDividends([
      dividend("d1", "10", "ARS"),
      withholding("t1", "3"),
    ]);
    expect(row!.taxArs).toBe("3.00");
    expect(row!.netArs).toBe("7.00");
  });
});
