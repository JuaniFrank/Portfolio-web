import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  contrastRatioFromLuminance,
  oklchRelativeLuminance,
  parseOklch,
  relativeLuminanceFromHex,
} from "./contrast";

describe("parseOklch", () => {
  it("parsea L en 0-1", () => {
    expect(parseOklch("oklch(0.22 0.03 255)")).toEqual({ l: 0.22, c: 0.03, h: 255 });
  });

  it("parsea L en porcentaje", () => {
    expect(parseOklch("oklch(14.1% 0.005 285.823)")).toEqual({ l: 0.141, c: 0.005, h: 285.823 });
  });
});

describe("contrastRatio — referencias conocidas", () => {
  it("blanco vs negro puro da 21:1 (el máximo WCAG)", () => {
    expect(contrastRatio("oklch(1 0 0)", "oklch(0 0 0)")).toBeCloseTo(21, 1);
  });

  it("un color contra sí mismo da 1:1", () => {
    expect(contrastRatio("oklch(0.5 0.1 200)", "oklch(0.5 0.1 200)")).toBeCloseTo(1, 5);
  });

  it("el orden de los argumentos no importa", () => {
    const a = "oklch(0.9 0.02 260)";
    const b = "oklch(0.2 0.02 260)";
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
  });

  it("coincide (con tolerancia) con la luminancia calculada desde el hex equivalente", () => {
    // zinc-950 de Tailwind: oklch(14.1% 0.005 285.823) ≈ #09090b
    const fromOklch = oklchRelativeLuminance("oklch(14.1% 0.005 285.823)");
    const fromHex = relativeLuminanceFromHex("#09090b");
    expect(fromOklch).toBeCloseTo(fromHex, 2);
  });
});

describe("contrastRatioFromLuminance", () => {
  it("replica la fórmula WCAG (L1+0.05)/(L2+0.05) con el más claro arriba", () => {
    expect(contrastRatioFromLuminance(1, 0)).toBeCloseTo(21, 5);
    expect(contrastRatioFromLuminance(0, 1)).toBeCloseTo(21, 5);
  });
});
