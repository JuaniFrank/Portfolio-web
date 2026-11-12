import { describe, expect, it } from "vitest";
import { ADR_SYMBOL_BY_LOCAL_TICKER, adrSymbolFor } from "./adr-map";

describe("adrSymbolFor", () => {
  it("maps well-known BYMA tickers to their Yahoo ADR symbol", () => {
    expect(adrSymbolFor("GGAL")).toBe("GGAL");
    expect(adrSymbolFor("YPFD")).toBe("YPF");
    expect(adrSymbolFor("PAMP")).toBe("PAM");
    expect(adrSymbolFor("TGSU2")).toBe("TGS");
    expect(adrSymbolFor("TECO2")).toBe("TEO");
    expect(adrSymbolFor("CRES")).toBe("CRESY");
    expect(adrSymbolFor("IRSA")).toBe("IRS");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(adrSymbolFor(" ypfd ")).toBe("YPF");
  });

  it("returns null when the ticker has no ADR", () => {
    expect(adrSymbolFor("ALUA")).toBeNull();
    expect(adrSymbolFor("")).toBeNull();
    expect(adrSymbolFor(null)).toBeNull();
    expect(adrSymbolFor(undefined)).toBeNull();
  });

  it("does not leak Object.prototype keys", () => {
    expect(adrSymbolFor("constructor")).toBeNull();
    expect(adrSymbolFor("toString")).toBeNull();
  });

  it("only holds uppercase symbols", () => {
    for (const [local, adr] of Object.entries(ADR_SYMBOL_BY_LOCAL_TICKER)) {
      expect(local).toBe(local.toUpperCase());
      expect(adr).toBe(adr.toUpperCase());
    }
  });
});
