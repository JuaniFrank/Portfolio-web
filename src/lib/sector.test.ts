import { describe, expect, it } from "vitest";
import { resolveRawSector, resolveSector, translateSector } from "./sector";

describe("resolveRawSector", () => {
  it("prioriza instrumentSector sobre las demás fuentes", () => {
    expect(
      resolveRawSector({
        instrumentSector: "Technology",
        baseInstrumentSector: "Energy",
        underlyingAssetSector: "Utilities",
      })
    ).toBe("Technology");
  });

  it("cae a baseInstrumentSector cuando falta instrumentSector", () => {
    expect(
      resolveRawSector({
        instrumentSector: null,
        baseInstrumentSector: "Energy",
        underlyingAssetSector: "Utilities",
      })
    ).toBe("Energy");
  });

  it("cae a underlyingAssetSector cuando faltan las dos primeras", () => {
    expect(
      resolveRawSector({
        instrumentSector: null,
        baseInstrumentSector: null,
        underlyingAssetSector: "Utilities",
      })
    ).toBe("Utilities");
  });

  it("devuelve null cuando ninguna fuente tiene dato", () => {
    expect(
      resolveRawSector({ instrumentSector: null, baseInstrumentSector: null, underlyingAssetSector: null })
    ).toBeNull();
  });

  it("los campos opcionales pueden omitirse", () => {
    expect(resolveRawSector({ instrumentSector: "Energy" })).toBe("Energy");
  });
});

describe("translateSector", () => {
  it("traduce un sector conocido de Yahoo", () => {
    expect(translateSector("Technology", "STOCK_US")).toBe("Tecnología");
  });

  it("traduce alias/variantes históricas", () => {
    expect(translateSector("Financials", "STOCK_US")).toBe("Servicios financieros");
    expect(translateSector("Consumer Staples", "STOCK_US")).toBe("Consumo defensivo");
  });

  it("pasa un sector crudo desconocido tal cual", () => {
    expect(translateSector("Aerospace & Defense", "STOCK_US")).toBe("Aerospace & Defense");
  });

  it("sintetiza por tipo de instrumento cuando no hay sector crudo", () => {
    expect(translateSector(null, "ETF")).toBe("ETF");
    expect(translateSector(null, "BOND_AR")).toBe("Renta fija");
    expect(translateSector(null, "LETRA")).toBe("Renta fija");
    expect(translateSector(null, "ON")).toBe("Renta fija");
    expect(translateSector(null, "FCI")).toBe("Fondos comunes");
    expect(translateSector(null, "CRYPTO")).toBe("Cripto");
    expect(translateSector(null, "STABLECOIN")).toBe("Cripto");
  });

  it("cae a 'Sin clasificar' para un tipo sin sector sintético (ej. STOCK_US sin dato)", () => {
    expect(translateSector(null, "STOCK_US")).toBe("Sin clasificar");
  });

  it("un string vacío o solo espacios se trata como ausente", () => {
    expect(translateSector("   ", "STOCK_US")).toBe("Sin clasificar");
  });
});

describe("resolveSector", () => {
  it("compone fallback + traducción en una sola llamada", () => {
    expect(
      resolveSector(
        { instrumentSector: null, baseInstrumentSector: null, underlyingAssetSector: "Technology" },
        "CEDEAR"
      )
    ).toBe("Tecnología");
  });

  it("sintetiza por tipo cuando las tres fuentes están vacías", () => {
    expect(
      resolveSector(
        { instrumentSector: null, baseInstrumentSector: null, underlyingAssetSector: null },
        "ON"
      )
    ).toBe("Renta fija");
  });
});
