import { describe, expect, it } from "vitest";
import {
  basisForInstrumentType,
  distanceToTargetPct,
  evaluate,
  hasReachedTarget,
  isArmed,
  targetStatus,
} from "./evaluate";

const above = { targetPrice: 100, direction: "ABOVE" as const };
const below = { targetPrice: 100, direction: "BELOW" as const };

describe("evaluate", () => {
  it("ABOVE dispara por encima del objetivo y en el límite exacto", () => {
    expect(evaluate(above, 100.01)).toBe(true);
    expect(evaluate(above, 100)).toBe(true);
    expect(evaluate(above, 99.99)).toBe(false);
  });

  it("BELOW dispara por debajo del objetivo y en el límite exacto", () => {
    expect(evaluate(below, 99.99)).toBe(true);
    expect(evaluate(below, 100)).toBe(true);
    expect(evaluate(below, 100.01)).toBe(false);
  });

  it("sin precio (null, undefined o no finito) nunca dispara", () => {
    for (const price of [null, undefined, Number.NaN, Infinity, -Infinity]) {
      expect(evaluate(above, price)).toBe(false);
      expect(evaluate(below, price)).toBe(false);
    }
  });
});

describe("evaluate con precios no positivos", () => {
  it("un precio 0 o negativo cuenta como sin precio y nunca dispara", () => {
    for (const price of [0, -1, -0.01]) {
      expect(evaluate(below, price)).toBe(false);
      expect(evaluate(above, price)).toBe(false);
    }
  });
});

describe("isArmed", () => {
  it("un objetivo está armado mientras no tenga triggeredAt", () => {
    expect(isArmed({ triggeredAt: null })).toBe(true);
    expect(isArmed({ triggeredAt: new Date("2026-10-27T12:00:00Z") })).toBe(false);
  });
});

describe("distanceToTargetPct", () => {
  it("es cuánto falta para llegar al objetivo, en % del precio actual", () => {
    expect(distanceToTargetPct(80, 100)).toBeCloseTo(25);
    expect(distanceToTargetPct(125, 100)).toBeCloseTo(-20);
  });

  it("es null sin precio o con precio no positivo", () => {
    expect(distanceToTargetPct(null, 100)).toBeNull();
    expect(distanceToTargetPct(0, 100)).toBeNull();
  });
});

describe("targetStatus", () => {
  it("disparado por el worker gana sobre el precio actual", () => {
    expect(targetStatus({ ...below, triggeredAt: new Date() }, 150)).toBe("triggered");
  });

  it("armado pero con el precio ya en zona se muestra como alcanzado", () => {
    expect(targetStatus({ ...below, triggeredAt: null }, 90)).toBe("reached");
  });

  it("armado y fuera de zona (o sin precio) sigue armado", () => {
    expect(targetStatus({ ...below, triggeredAt: null }, 150)).toBe("armed");
    expect(targetStatus({ ...below, triggeredAt: null }, null)).toBe("armed");
  });
});

describe("hasReachedTarget", () => {
  const targets = [
    { ...below, currency: "USD" as const },
    { targetPrice: 500, direction: "ABOVE" as const, currency: "ARS" as const },
  ];

  it("es verdadero si algún objetivo de la misma moneda está cumplido", () => {
    expect(hasReachedTarget(targets, 90, "USD")).toBe(true);
  });

  it("ignora objetivos de otra moneda", () => {
    expect(hasReachedTarget(targets, 90, "ARS")).toBe(false);
  });

  it("es falso sin precio o sin objetivos", () => {
    expect(hasReachedTarget(targets, null, "USD")).toBe(false);
    expect(hasReachedTarget([], 90, "USD")).toBe(false);
  });
});

describe("basisForInstrumentType", () => {
  it("CEDEAR mide en USD y la acción local en ARS", () => {
    expect(basisForInstrumentType("CEDEAR")).toBe("USD");
    expect(basisForInstrumentType("STOCK_AR")).toBe("ARS");
  });

  it("el resto de los tipos no admite objetivos", () => {
    for (const type of ["BOND_AR", "ON", "FCI", "ETF", "STOCK_US", "CASH"]) {
      expect(basisForInstrumentType(type)).toBeNull();
    }
  });
});
