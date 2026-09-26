import { describe, expect, it } from "vitest";
import { PALETTE_STORAGE_KEY, PALETTES, isPaletteId, noFlashScript, resolvePalette } from "./palettes";

describe("PALETTES", () => {
  it("registra Default y Finanzas, en ese orden", () => {
    expect(PALETTES).toEqual([
      { id: "default", label: "Default" },
      { id: "finanzas", label: "Finanzas" },
    ]);
  });
});

describe("resolvePalette", () => {
  it("valores válidos se devuelven tal cual", () => {
    expect(resolvePalette("default")).toBe("default");
    expect(resolvePalette("finanzas")).toBe("finanzas");
  });

  it("valores inválidos o ausentes caen a default", () => {
    expect(resolvePalette(null)).toBe("default");
    expect(resolvePalette(undefined)).toBe("default");
    expect(resolvePalette("")).toBe("default");
    expect(resolvePalette("bogus")).toBe("default");
    expect(resolvePalette(123)).toBe("default");
    expect(resolvePalette({})).toBe("default");
  });
});

describe("isPaletteId", () => {
  it("acepta solo ids registrados", () => {
    expect(isPaletteId("default")).toBe(true);
    expect(isPaletteId("finanzas")).toBe(true);
    expect(isPaletteId("bogus")).toBe(false);
    expect(isPaletteId(42)).toBe(false);
  });
});

describe("noFlashScript", () => {
  it("referencia la storage key y los ids no-default, pero no setea nada para default", () => {
    const script = noFlashScript();
    expect(script).toContain(PALETTE_STORAGE_KEY);
    expect(script).toContain("finanzas");
    expect(script).toContain("data-palette");
    // "default" no debe aparecer como valor a setear (no hay atributo para el default)
    expect(script.includes('"default"')).toBe(false);
  });
});
