import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";

/**
 * Test de integración (pero sigue siendo puro/offline: solo lee un archivo del
 * repo con `fs`) que verifica que el bloque `html[data-palette="finanzas"]` de
 * `globals.css` cumple WCAG AA para los pares texto/fondo que importan:
 * secundario (500/400) contra los dos fondos (950 page / 900 card) a 4.5:1, y
 * terciario (600) a 3:1 contra ambos.
 */

const CSS_PATH = fileURLToPath(new URL("../../app/globals.css", import.meta.url));

function extractFinanzasZincScale(): Record<string, string> {
  const css = readFileSync(CSS_PATH, "utf8");

  const blockMatch = css.match(/html\[data-palette=["']finanzas["']\]\s*\{([^}]*)\}/);
  if (!blockMatch) {
    throw new Error('No se encontró el bloque html[data-palette="finanzas"] en globals.css');
  }

  const block = blockMatch[1] ?? "";
  const scale: Record<string, string> = {};
  const re = /--color-zinc-(\d+):\s*(oklch\([^)]*\))\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    const [, id, value] = match;
    if (id && value) scale[id] = value;
  }
  return scale;
}

const STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;

function step(scale: Record<string, string>, id: (typeof STEPS)[number]): string {
  const value = scale[id];
  if (!value) throw new Error(`falta --color-zinc-${id} en el bloque finanzas`);
  return value;
}

describe("paleta Finanzas — contraste WCAG AA en globals.css", () => {
  const scale = extractFinanzasZincScale();

  it("define los 11 pasos de la escala zinc", () => {
    for (const id of STEPS) {
      expect(scale[id], `falta --color-zinc-${id}`).toBeTruthy();
    }
  });

  const s950 = step(scale, "950");
  const s900 = step(scale, "900");
  const s800 = step(scale, "800");
  const s700 = step(scale, "700");
  const s600 = step(scale, "600");
  const s500 = step(scale, "500");
  const s400 = step(scale, "400");
  const s50 = step(scale, "50");

  it("texto secundario zinc-500 llega a AA (4.5:1) contra 950 y 900", () => {
    expect(contrastRatio(s500, s950)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(s500, s900)).toBeGreaterThanOrEqual(4.5);
  });

  it("texto secundario zinc-400 llega a AA (4.5:1) contra 950 y 900", () => {
    expect(contrastRatio(s400, s950)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(s400, s900)).toBeGreaterThanOrEqual(4.5);
  });

  it("texto terciario zinc-600 llega al mínimo (3:1) contra 950 y 900", () => {
    expect(contrastRatio(s600, s950)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(s600, s900)).toBeGreaterThanOrEqual(3);
  });

  it("texto primario zinc-50 tiene contraste alto contra 950", () => {
    expect(contrastRatio(s50, s950)).toBeGreaterThanOrEqual(12);
  });

  it("900 (card) se distingue visiblemente de 950 (page)", () => {
    expect(contrastRatio(s900, s950)).toBeGreaterThan(1.2);
  });

  it("800/700 (bordes) se distinguen del fondo 900", () => {
    expect(contrastRatio(s800, s900)).toBeGreaterThan(1.3);
    expect(contrastRatio(s700, s900)).toBeGreaterThan(1.5);
  });
});
