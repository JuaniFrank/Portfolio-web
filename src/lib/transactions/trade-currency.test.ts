import { describe, expect, it } from "vitest";
import { convertTradeToArs } from "./trade-currency";

const CCL: Record<string, number> = { "2025-03-10": 1000, "2025-04-10": 1200 };
const cclAt = (date: Date) => CCL[date.toISOString().slice(0, 10)] ?? null;

describe("convertTradeToArs", () => {
  it("is an exact no-op for ARS trades (string untouched)", () => {
    const r = convertTradeToArs(
      { netAmount: "1234.50", currencyCode: "ARS", tradeDate: new Date("2025-03-10T12:00:00Z") },
      cclAt
    );
    expect(r.netAmount).toBe("1234.50");
    expect(r.isUsd).toBe(false);
    expect(r.rate).toBe(1000);
    expect(r.rawNetAmount).toBe(1234.5);
  });

  it("converts USD at the CCL of the trade date, not another day", () => {
    const r = convertTradeToArs(
      { netAmount: "100", currencyCode: "USD", tradeDate: new Date("2025-04-10T12:00:00Z") },
      cclAt
    );
    expect(Number(r.netAmount)).toBe(120000);
    expect(r.isUsd).toBe(true);
    expect(r.rate).toBe(1200);
    expect(r.rawNetAmount).toBe(100);
  });

  it.each(["USD_MEP", "USD_CABLE", "USDT", "USDC", "usd"])("treats %s as USD", (code) => {
    const r = convertTradeToArs(
      { netAmount: "10", currencyCode: code, tradeDate: new Date("2025-03-10T12:00:00Z") },
      cclAt
    );
    expect(Number(r.netAmount)).toBe(10000);
  });

  it("keeps the raw amount when no CCL exists for the date (last resort)", () => {
    const r = convertTradeToArs(
      { netAmount: "100", currencyCode: "USD", tradeDate: new Date("2020-01-01T12:00:00Z") },
      cclAt
    );
    expect(r.netAmount).toBe("100");
    expect(r.rate).toBeNull();
    expect(r.isUsd).toBe(true);
  });

  it("accepts ISO string trade dates", () => {
    const r = convertTradeToArs(
      { netAmount: "-100", currencyCode: "USD", tradeDate: "2025-03-10T12:00:00.000Z" },
      cclAt
    );
    expect(Number(r.netAmount)).toBe(-100000);
  });
});
