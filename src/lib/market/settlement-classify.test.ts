import { describe, expect, it } from "vitest";
import { currencyForSettlement, moreSpecific } from "./settlement-classify";

describe("currencyForSettlement", () => {
  it("maps ARS to ARS", () => {
    expect(currencyForSettlement("ARS")).toBe("ARS");
  });

  it("maps USD, MEP, and CCL all to USD", () => {
    expect(currencyForSettlement("USD")).toBe("USD");
    expect(currencyForSettlement("MEP")).toBe("USD");
    expect(currencyForSettlement("CCL")).toBe("USD");
  });
});

describe("moreSpecific — the AD-5 lattice (ARS < USD < MEP|CCL)", () => {
  it("never downgrades MEP to USD", () => {
    expect(moreSpecific("MEP", "USD")).toBe("MEP");
  });

  it("never downgrades CCL to USD", () => {
    expect(moreSpecific("CCL", "USD")).toBe("CCL");
  });

  it("never downgrades USD to ARS", () => {
    expect(moreSpecific("USD", "ARS")).toBe("USD");
  });

  it("never downgrades MEP/CCL to ARS", () => {
    expect(moreSpecific("MEP", "ARS")).toBe("MEP");
    expect(moreSpecific("CCL", "ARS")).toBe("CCL");
  });

  it("upgrades USD to MEP or CCL when the incoming value is more specific", () => {
    expect(moreSpecific("USD", "MEP")).toBe("MEP");
    expect(moreSpecific("USD", "CCL")).toBe("CCL");
  });

  it("upgrades ARS to any incoming settlement", () => {
    expect(moreSpecific("ARS", "USD")).toBe("USD");
    expect(moreSpecific("ARS", "MEP")).toBe("MEP");
  });

  it("is a no-op when the incoming value equals the stored value", () => {
    expect(moreSpecific("MEP", "MEP")).toBe("MEP");
    expect(moreSpecific("ARS", "ARS")).toBe("ARS");
  });

  it("MEP and CCL are incomparable siblings — neither downgrades the other", () => {
    expect(moreSpecific("MEP", "CCL")).toBe("MEP");
    expect(moreSpecific("CCL", "MEP")).toBe("CCL");
  });
});
