import { describe, expect, it } from "vitest";
import { instrumentKey } from "./instrument-identity";

/** Byte-identical reference: the deleted commit-import.ts instrumentKey(). */
function referenceInstrumentKey(parts: {
  ticker: string;
  type: string;
  currencyCode: string;
  venueCode: string | null;
}): string {
  return `${parts.ticker}|${parts.type}|${parts.currencyCode}|${parts.venueCode ?? ""}`;
}

describe("instrumentKey", () => {
  it("is byte-identical to the deleted commit-import.ts instrumentKey()", () => {
    const input = {
      ticker: "NVDAD",
      type: "CEDEAR" as const,
      currencyCode: "USD",
      venueCode: "BYMA",
    };
    expect(instrumentKey(input)).toBe(referenceInstrumentKey(input));
    expect(instrumentKey(input)).toBe("NVDAD|CEDEAR|USD|BYMA");
  });

  it("renders a null venueCode as a trailing empty segment", () => {
    expect(
      instrumentKey({ ticker: "CASH-ARS", type: "CASH" as const, currencyCode: "ARS", venueCode: null })
    ).toBe("CASH-ARS|CASH|ARS|");
  });

  it("produces different keys for rows differing only in currencyCode", () => {
    const base = { ticker: "NVDAD", type: "CEDEAR" as const, venueCode: "BYMA" };
    const usd = instrumentKey({ ...base, currencyCode: "USD" });
    const ars = instrumentKey({ ...base, currencyCode: "ARS" });
    expect(usd).not.toBe(ars);
  });
});
