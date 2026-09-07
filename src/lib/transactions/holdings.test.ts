import { describe, expect, it } from "vitest";
import { buildHoldings, type TradeForHoldings } from "./holdings";

/**
 * The USD figures are the point of these tests: a position's dollar return has to be
 * measured against the CCL of the day each purchase was made, not against today's.
 * Converting both cost and market value at today's rate cancels the exchange rate out
 * and returns the exact same percentage in both currencies — which is precisely the
 * number that carries no information in Argentina.
 */

const CCL: Record<string, number> = {
  "2025-01-15": 1000,
  "2025-06-15": 1200,
  "2025-09-01": 1500,
};

function cclAt(date: Date): number | null {
  return CCL[date.toISOString().slice(0, 10)] ?? null;
}

function trade(over: Partial<TradeForHoldings> & { tradeDate: string }): TradeForHoldings {
  return {
    instrumentId: "i1",
    ticker: "AAPL",
    instrumentType: "CEDEAR",
    instrumentName: "Apple",
    type: "BUY",
    quantity: "10",
    price: "1000",
    netAmount: "10000",
    ...over,
  };
}

describe("buildHoldings — USD cost basis at historical CCL", () => {
  it("leaves the USD fields null when no FX context is supplied", () => {
    const [holding] = buildHoldings([trade({ tradeDate: "2025-01-15T12:00:00.000Z" })], new Map());

    expect(holding!.costBasisUsd).toBeNull();
    expect(holding!.marketValueUsd).toBeNull();
    expect(holding!.pnlUsd).toBeNull();
    expect(holding!.pnlPercentUsd).toBeNull();
  });

  it("converts each purchase at the CCL of its own trade date", () => {
    const trades = [
      trade({ tradeDate: "2025-01-15T12:00:00.000Z" }), // 10.000 ARS @ 1000 = 10 USD
      trade({ tradeDate: "2025-06-15T12:00:00.000Z", netAmount: "12000" }), // 12.000 @ 1200 = 10 USD
    ];

    const [holding] = buildHoldings(trades, new Map([["i1", "1500"]]), undefined, {
      cclAt,
      currentCcl: 1500,
    });

    expect(holding!.costBasisArs).toBe("22000.00");
    expect(holding!.costBasisUsd).toBe("20.00");
    // 20 units * 1500 = 30.000 ARS / 1500 = 20 USD
    expect(holding!.marketValueUsd).toBe("20.00");
    expect(holding!.pnlUsd).toBe("0.00");
    expect(holding!.pnlPercentUsd).toBe("0.00");
  });

  it("does not report the same percentage in both currencies when the CCL moved", () => {
    // Compra a CCL 1000, el papel sube 50 % en pesos, pero el CCL subió 50 % también:
    // en dólares el rendimiento es 0.
    const [holding] = buildHoldings(
      [trade({ tradeDate: "2025-01-15T12:00:00.000Z" })],
      new Map([["i1", "1500"]]),
      undefined,
      { cclAt, currentCcl: 1500 }
    );

    expect(holding!.pnlPercent).toBe("50.00");
    expect(holding!.pnlPercentUsd).toBe("0.00");
  });

  it("releases USD cost proportionally on a sale, like the ARS basis does", () => {
    const trades = [
      trade({ tradeDate: "2025-01-15T12:00:00.000Z" }), // 10 u, 10 USD
      trade({ tradeDate: "2025-06-15T12:00:00.000Z", type: "SELL", quantity: "5", netAmount: "9000" }),
    ];

    const [holding] = buildHoldings(trades, new Map([["i1", "1800"]]), undefined, {
      cclAt,
      currentCcl: 1500,
    });

    expect(holding!.quantity).toBe("5");
    expect(holding!.costBasisArs).toBe("5000.00");
    expect(holding!.costBasisUsd).toBe("5.00");
    // 5 u * 1800 = 9000 ARS / 1500 = 6 USD contra 5 USD de costo
    expect(holding!.marketValueUsd).toBe("6.00");
    expect(holding!.pnlUsd).toBe("1.00");
    expect(holding!.pnlPercentUsd).toBe("20.00");
  });

  it("gives up on the USD basis when a purchase predates the CCL history", () => {
    const trades = [
      trade({ tradeDate: "2024-03-01T12:00:00.000Z" }), // sin CCL
      trade({ tradeDate: "2025-06-15T12:00:00.000Z", netAmount: "12000" }),
    ];

    const [holding] = buildHoldings(trades, new Map([["i1", "1500"]]), undefined, {
      cclAt,
      currentCcl: 1500,
    });

    expect(holding!.costBasisUsd).toBeNull();
    expect(holding!.pnlUsd).toBeNull();
    expect(holding!.pnlPercentUsd).toBeNull();
    // El valor de mercado en dólares sí es medible: es de hoy contra el CCL de hoy.
    expect(holding!.marketValueUsd).toBe("20.00");
  });

  it("has no USD market value without a current CCL", () => {
    const [holding] = buildHoldings(
      [trade({ tradeDate: "2025-01-15T12:00:00.000Z" })],
      new Map([["i1", "1500"]]),
      undefined,
      { cclAt, currentCcl: null }
    );

    expect(holding!.costBasisUsd).toBe("10.00");
    expect(holding!.marketValueUsd).toBeNull();
    expect(holding!.pnlUsd).toBeNull();
  });
});
