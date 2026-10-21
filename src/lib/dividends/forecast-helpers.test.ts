import { describe, expect, it } from "vitest";
import { isBymaQuoted, pickCurrency } from "./forecast-helpers";

describe("pickCurrency", () => {
  it.each(["USD", "usd", "USD_MEP", "USDT"])("maps %s to USD", (code) => {
    expect(pickCurrency(code)).toBe("USD");
  });

  it.each([null, "ARS", "EUR"])("maps %s to ARS", (code) => {
    expect(pickCurrency(code)).toBe("ARS");
  });
});

describe("isBymaQuoted", () => {
  it("includes CEDEAR: its dividends must come from the .BA line, per CEDEAR", () => {
    expect(isBymaQuoted("CEDEAR")).toBe(true);
  });

  it.each(["STOCK_AR", "BOND_AR", "LETRA", "ON"] as const)("includes %s", (type) => {
    expect(isBymaQuoted(type)).toBe(true);
  });

  it("excludes US-listed types", () => {
    expect(isBymaQuoted("STOCK_US")).toBe(false);
  });
});
