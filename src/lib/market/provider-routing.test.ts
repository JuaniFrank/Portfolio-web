import { describe, expect, it } from "vitest";
import { resolveMonitoringRouting } from "./provider-routing";

const base = {
  id: "instrument-1",
  ticker: "AAPL",
  currencyCode: "ARS",
  settlement: "ARS" as const,
};

describe("resolveMonitoringRouting", () => {
  it("uses Yahoo .BA for Argentine stocks and CEDEARs when preferYahoo is set", () => {
    expect(
      resolveMonitoringRouting({ ...base, type: "STOCK_AR" }, "native", true)
    ).toMatchObject({ provider: "yahoo", externalSymbol: "AAPL.BA", currency: "ARS" });

    expect(
      resolveMonitoringRouting({ ...base, type: "CEDEAR" }, "native", true)
    ).toMatchObject({ provider: "yahoo", externalSymbol: "AAPL.BA", currency: "ARS" });
  });

  it("uses data912 (no .BA) for Argentine stocks and CEDEARs by default", () => {
    expect(resolveMonitoringRouting({ ...base, type: "STOCK_AR" }, "native")).toMatchObject({
      provider: "data912",
      externalSymbol: "AAPL",
      currency: "ARS",
    });
  });

  it("uses Yahoo without .BA for USA stocks", () => {
    expect(
      resolveMonitoringRouting({ ...base, type: "STOCK_US", currencyCode: "USD" }, "native")
    ).toMatchObject({ provider: "yahoo", externalSymbol: "AAPL", currency: "USD" });
  });

  it("always resolves an object for cedear-underlying — falls back to the instrument's own ticker when no underlying asset is linked", () => {
    expect(
      resolveMonitoringRouting(
        { ...base, type: "CEDEAR", underlyingAsset: { ticker: "AAPL" } },
        "cedear-underlying"
      )
    ).toMatchObject({ externalSymbol: "AAPL", currency: "USD" });

    expect(
      resolveMonitoringRouting({ ...base, type: "CEDEAR", underlyingAsset: null }, "cedear-underlying")
    ).toMatchObject({ externalSymbol: "AAPL", currency: "USD" });
  });

  describe('"spot" — currency-aware quote routing (T-30, design AD-6)', () => {
    it("a linked variant resolves off the base's .BA symbol at currency ARS", () => {
      const result = resolveMonitoringRouting(
        {
          ...base,
          ticker: "NVDAD",
          type: "CEDEAR",
          currencyCode: "USD",
          settlement: "MEP",
          baseInstrument: { ticker: "NVDA" },
        },
        "spot"
      );
      expect(result).toMatchObject({ externalSymbol: "NVDA.BA", currency: "ARS" });
    });

    it("a variant with settlement USD and NO base link resolves its own .BA symbol at currency ARS", () => {
      const result = resolveMonitoringRouting(
        {
          ...base,
          ticker: "ZZZD",
          type: "CEDEAR",
          currencyCode: "USD",
          settlement: "USD",
          baseInstrument: null,
        },
        "spot"
      );
      expect(result).toMatchObject({ externalSymbol: "ZZZD.BA", currency: "ARS" });
    });

    it("a base resolves its own symbol", () => {
      const result = resolveMonitoringRouting(
        { ...base, type: "STOCK_AR", currencyCode: "ARS", settlement: "ARS" },
        "spot"
      );
      expect(result).toMatchObject({ externalSymbol: "AAPL.BA", currency: "ARS" });
    });

    it("branches on the LINK (baseInstrumentId), not on settlement — a settlement=USD row with a known base still prices off the base", () => {
      const result = resolveMonitoringRouting(
        {
          ...base,
          ticker: "NVDAD",
          type: "CEDEAR",
          currencyCode: "USD",
          settlement: "USD", // split not yet determined — still has a base link
          baseInstrument: { ticker: "NVDA" },
        },
        "spot"
      );
      expect(result).toMatchObject({ externalSymbol: "NVDA.BA", currency: "ARS" });
    });

    it("a STOCK_US case is unaffected by the spot branch", () => {
      const result = resolveMonitoringRouting(
        { ...base, type: "STOCK_US", currencyCode: "USD", settlement: "ARS" },
        "spot"
      );
      expect(result).toMatchObject({ provider: "yahoo", externalSymbol: "AAPL", currency: "USD" });
    });
  });
});
