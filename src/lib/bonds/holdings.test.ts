import { describe, expect, it } from "vitest";
import { buildBondHoldings, type TradeForBondHoldings } from "./holdings";

/**
 * ONs are priced in dollars, so the mirror of the CEDEAR problem applies here: their
 * peso cost is what the purchase cost in pesos on its own day. Multiplying the USD cost
 * by today's CCL would make the ARS return identical to the USD one.
 */

const CCL: Record<string, number> = {
  "2025-01-15": 1000,
  "2025-06-15": 1200,
};

function cclAt(date: Date): number | null {
  return CCL[date.toISOString().slice(0, 10)] ?? null;
}

function trade(over: Partial<TradeForBondHoldings> & { tradeDate: string }): TradeForBondHoldings {
  return {
    instrumentId: "b1",
    ticker: "YMCJO",
    type: "BUY",
    quantity: "100",
    netAmount: "100",
    currencyCode: "USD",
    ...over,
  };
}

describe("buildBondHoldings — ARS cost basis at historical CCL", () => {
  it("leaves the ARS basis null without an FX lookup", () => {
    const [holding] = buildBondHoldings([trade({ tradeDate: "2025-01-15T12:00:00.000Z" })]);

    expect(holding!.costBasisUsd).toBe("100.00");
    expect(holding!.costBasisArs).toBeNull();
  });

  it("converts each purchase at the CCL of its own date", () => {
    const trades = [
      trade({ tradeDate: "2025-01-15T12:00:00.000Z" }), // 100 USD @ 1000 = 100.000 ARS
      trade({ tradeDate: "2025-06-15T12:00:00.000Z" }), // 100 USD @ 1200 = 120.000 ARS
    ];

    const [holding] = buildBondHoldings(trades, { cclAt });

    expect(holding!.costBasisUsd).toBe("200.00");
    expect(holding!.costBasisArs).toBe("220000.00");
  });

  it("releases ARS cost proportionally on a sale", () => {
    const trades = [
      trade({ tradeDate: "2025-01-15T12:00:00.000Z" }),
      trade({ tradeDate: "2025-06-15T12:00:00.000Z", type: "SELL", quantity: "50", netAmount: "60" }),
    ];

    const [holding] = buildBondHoldings(trades, { cclAt });

    expect(holding!.nominalHeld).toBe("50");
    expect(holding!.costBasisUsd).toBe("50.00");
    expect(holding!.costBasisArs).toBe("50000.00");
  });

  it("gives up on the ARS basis when a purchase predates the CCL history", () => {
    const [holding] = buildBondHoldings([trade({ tradeDate: "2024-03-01T12:00:00.000Z" })], {
      cclAt,
    });

    expect(holding!.costBasisArs).toBeNull();
  });
});
