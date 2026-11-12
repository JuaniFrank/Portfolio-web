import { describe, expect, it } from "vitest";
import { planQuoteAttempts } from "./quote-source";

const ggal = { ticker: "GGAL", type: "STOCK_AR" as const };
const aapl = { ticker: "AAPL", type: "CEDEAR" as const };

describe("planQuoteAttempts", () => {
  it("tries data912 live then the .BA Yahoo symbol for native ARS routing", () => {
    expect(
      planQuoteAttempts(ggal, { provider: "data912", externalSymbol: "GGAL", currency: "ARS" })
    ).toEqual([
      { provider: "data912", ticker: "GGAL", type: "STOCK_AR" },
      { provider: "yahoo", symbol: "GGAL.BA", fresh: true },
    ]);
  });

  it("works the same for a CEDEAR in native mode", () => {
    expect(
      planQuoteAttempts(aapl, { provider: "data912", externalSymbol: "AAPL", currency: "ARS" })
    ).toEqual([
      { provider: "data912", ticker: "AAPL", type: "CEDEAR" },
      { provider: "yahoo", symbol: "AAPL.BA", fresh: true },
    ]);
  });

  it("quotes the routed Yahoo symbol fresh for the ADR view", () => {
    expect(
      planQuoteAttempts(ggal, { provider: "yahoo", externalSymbol: "GGAL", currency: "USD" })
    ).toEqual([{ provider: "yahoo", symbol: "GGAL", fresh: true }]);
  });

  it("quotes the underlying on Yahoo even when the series routes to FMP", () => {
    expect(
      planQuoteAttempts(aapl, { provider: "fmp", externalSymbol: "AAPL", currency: "USD" })
    ).toEqual([{ provider: "yahoo", symbol: "AAPL", fresh: true }]);
  });

  it("has no attempts for the derived theoretical CEDEAR series", () => {
    expect(
      planQuoteAttempts(aapl, { provider: "derived", externalSymbol: "AAPL", currency: "ARS" })
    ).toEqual([]);
  });

  it("has no attempts for instrument types data912 live does not cover", () => {
    expect(
      planQuoteAttempts(
        { ticker: "AL30", type: "BOND_AR" },
        { provider: "data912", externalSymbol: "AL30", currency: "ARS" }
      )
    ).toEqual([]);
  });
});
