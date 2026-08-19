import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseArgenBondHtml } from "./argen-bond-scraper";

const cs50cHtml = readFileSync(
  join(__dirname, "__fixtures__", "cs50c.html"),
  "utf-8"
);

describe("parseArgenBondHtml", () => {
  it("parsea el perfil del bono desde el bloque de resumen", () => {
    const result = parseArgenBondHtml(cs50cHtml);

    expect(result.maturityDate).toBe("2029-03-10");
    expect(result.currencyCode).toBe("USD");
    expect(result.rateType).toBe("FIXED");
    expect(result.couponFrequencyMonths).toBe(6);
  });

  it("no puede inferir valor nominal, fecha de emisión ni convención de días", () => {
    const result = parseArgenBondHtml(cs50cHtml);

    expect(result.faceValue).toBeNull();
    expect(result.issueDate).toBeNull();
    expect(result.dayCountConvention).toBeNull();
  });

  it("arma el cronograma de amortización solo con filas con amort. > 0, ordenado y sumando 100", () => {
    const result = parseArgenBondHtml(cs50cHtml);

    expect(result.amortizationSchedule).toEqual([
      { date: "2029-03-10", principalPct: 100 },
    ]);
    const total = result.amortizationSchedule.reduce(
      (sum, e) => sum + e.principalPct,
      0
    );
    expect(total).toBe(100);
  });

  it("estima couponRate a partir de la primera fila con residual pleno (100%)", () => {
    const result = parseArgenBondHtml(cs50cHtml);

    // La primera fila de la tabla (10/12/2025) tiene Interés 0% -- la estimación
    // toma esa fila porque es la primera con residual 100%, aun siendo un pago
    // pasado con cupón nulo en este fixture real.
    expect(result.couponRate).not.toBeNull();
    expect(result.couponRate).toBeGreaterThanOrEqual(0);
    expect(result.couponRate).toBeLessThan(0.5);
    expect(result.couponRate).toBeCloseTo(0, 5);
  });

  it("devuelve todos los campos en null y no tira excepción ante HTML sin tabla de flujos", () => {
    const result = parseArgenBondHtml("<html><body>not found</body></html>");

    expect(result).toEqual({
      faceValue: null,
      currencyCode: null,
      rateType: null,
      couponRate: null,
      couponFrequencyMonths: null,
      issueDate: null,
      maturityDate: null,
      amortizationSchedule: [],
      cashflowSchedule: [],
      dayCountConvention: null,
    });
  });

  it("arma el flujo de fondos completo con todas las filas (interés y amortización)", () => {
    const result = parseArgenBondHtml(cs50cHtml);

    expect(result.cashflowSchedule).toEqual([
      { date: "2025-12-10", interestPct: 0, principalPct: 0 },
      { date: "2026-09-10", interestPct: 5.44, principalPct: 0 },
      { date: "2027-03-10", interestPct: 3.6, principalPct: 0 },
      { date: "2027-09-10", interestPct: 3.65, principalPct: 0 },
      { date: "2028-03-10", interestPct: 3.62, principalPct: 0 },
      { date: "2028-09-10", interestPct: 3.65, principalPct: 0 },
      { date: "2029-03-10", interestPct: 3.6, principalPct: 100 },
    ]);
  });
});
