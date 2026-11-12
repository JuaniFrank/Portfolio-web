import { describe, expect, it } from "vitest";
import {
  convertBasisPrice,
  defaultBasis,
  moneyFactor,
  resolveBasisOptions,
  toBasisPrice,
  toChartPrice,
} from "./price-basis";

const cedear = { type: "CEDEAR" as const, ticker: "AAPL" };
const ggal = { type: "STOCK_AR" as const, ticker: "GGAL" };

describe("defaultBasis", () => {
  it("follows the currency of the active view", () => {
    expect(defaultBasis("native")).toBe("ars");
    expect(defaultBasis("cedear-theoretical")).toBe("ars");
    expect(defaultBasis("cedear-underlying")).toBe("usd");
    expect(defaultBasis("adr")).toBe("usd");
  });
});

describe("resolveBasisOptions", () => {
  it("offers no basis for instruments without a USD counterpart", () => {
    expect(
      resolveBasisOptions({
        instrument: { type: "STOCK_AR", ticker: "ZZZZ" },
        chartKind: "native",
        quotes: {},
        chartLastClose: 10,
      })
    ).toEqual([]);
    expect(
      resolveBasisOptions({
        instrument: { type: "BOND_AR", ticker: "AL30" },
        chartKind: "native",
        quotes: {},
        chartLastClose: 10,
      })
    ).toEqual([]);
  });

  it("labels CEDEAR bases and maps them to series kinds", () => {
    const options = resolveBasisOptions({
      instrument: cedear,
      chartKind: "native",
      quotes: { native: 20000, "cedear-underlying": 200 },
      chartLastClose: 19900,
    });
    expect(options.map((o) => [o.basis, o.kind, o.currency, o.label])).toEqual([
      ["ars", "native", "ARS", "CEDEAR (ARS)"],
      ["usd", "cedear-underlying", "USD", "Acción original (USD)"],
    ]);
  });

  it("labels AR stock bases with ADR", () => {
    const options = resolveBasisOptions({
      instrument: ggal,
      chartKind: "native",
      quotes: { native: 5000, adr: 5 },
      chartLastClose: 4900,
    });
    expect(options.map((o) => o.label)).toEqual(["Local (ARS)", "ADR (USD)"]);
    expect(options.map((o) => o.kind)).toEqual(["native", "adr"]);
  });

  it("uses factor 1 for the basis matching the chart view, even without a quote", () => {
    const [ars, usd] = resolveBasisOptions({
      instrument: cedear,
      chartKind: "native",
      quotes: {},
      chartLastClose: 19900,
    });
    expect(ars!).toMatchObject({ factor: 1, available: true, marketPrice: 19900 });
    expect(usd!).toMatchObject({ factor: null, available: false, marketPrice: null });
  });

  it("computes chart quote / basis quote for the other basis", () => {
    const [ars, usd] = resolveBasisOptions({
      instrument: cedear,
      chartKind: "native",
      quotes: { native: 20000, "cedear-underlying": 200 },
      chartLastClose: 19900,
    });
    expect(ars!).toMatchObject({ factor: 1, marketPrice: 20000 });
    expect(usd!).toMatchObject({ factor: 100, available: true, marketPrice: 200 });
  });

  it("works from the USD view toward the ARS basis", () => {
    const [ars, usd] = resolveBasisOptions({
      instrument: cedear,
      chartKind: "cedear-underlying",
      quotes: { native: 20000, "cedear-underlying": 200 },
      chartLastClose: 199,
    });
    expect(ars!.factor).toBeCloseTo(0.01);
    expect(usd!).toMatchObject({ factor: 1, marketPrice: 200 });
  });

  it("uses the last close as chart reference in the theoretical view", () => {
    const [ars, usd] = resolveBasisOptions({
      instrument: cedear,
      chartKind: "cedear-theoretical",
      quotes: { native: 20000, "cedear-underlying": 200 },
      chartLastClose: 21000,
    });
    expect(ars!.factor).toBeCloseTo(1.05);
    expect(usd!.factor).toBeCloseTo(105);
  });

  it("disables the other basis when a quote is missing or invalid", () => {
    const missingChart = resolveBasisOptions({
      instrument: cedear,
      chartKind: "native",
      quotes: { native: null, "cedear-underlying": 200 },
      chartLastClose: 19900,
    });
    expect(missingChart[1]!.available).toBe(false);
    const zeroBasis = resolveBasisOptions({
      instrument: cedear,
      chartKind: "native",
      quotes: { native: 20000, "cedear-underlying": 0 },
      chartLastClose: 19900,
    });
    expect(zeroBasis[1]!.factor).toBeNull();
  });
});

describe("price conversions", () => {
  it("converts between a basis and the chart scale", () => {
    expect(toChartPrice(200, 100)).toBe(20000);
    expect(toBasisPrice(20000, 100)).toBe(200);
  });

  it("converts a price between two bases through their factors", () => {
    // ARS basis (factor 1) -> USD basis (factor 100): 20000 ARS = 200 USD
    expect(convertBasisPrice(20000, 1, 100)).toBe(200);
    expect(convertBasisPrice(200, 100, 1)).toBe(20000);
  });

  it("returns null when a factor is missing", () => {
    expect(convertBasisPrice(200, null, 1)).toBeNull();
    expect(convertBasisPrice(200, 1, null)).toBeNull();
  });
});

describe("moneyFactor", () => {
  it("is 1 when the chart is already in pesos per unit", () => {
    expect(moneyFactor("native", {})).toBe(1);
  });

  it("theoretical CEDEAR: pesos actually paid per theoretical unit = native quote / series last close", () => {
    expect(moneyFactor("cedear-theoretical", { native: 20500 }, 20000)).toBeCloseTo(1.025, 6);
  });

  it("theoretical CEDEAR without the native quote or the reference is null (never the unscaled 1)", () => {
    expect(moneyFactor("cedear-theoretical", {}, 20000)).toBeNull();
    expect(moneyFactor("cedear-theoretical", { native: 20500 }, null)).toBeNull();
    expect(moneyFactor("cedear-theoretical", { native: 20500 })).toBeNull();
  });

  it("brings a USD chart price to pesos per unit actually paid (ADR: 30 USD vs 7000 ARS local)", () => {
    expect(moneyFactor("adr", { native: 7000, adr: 30 })).toBeCloseTo(7000 / 30, 6);
    expect(moneyFactor("cedear-underlying", { native: 20000, "cedear-underlying": 200 })).toBe(100);
  });

  it("is null when a quote is missing", () => {
    expect(moneyFactor("adr", { adr: 30 })).toBeNull();
    expect(moneyFactor("adr", { native: 7000 })).toBeNull();
    expect(moneyFactor("adr", { native: 7000, adr: null })).toBeNull();
  });
});
