import { describe, expect, it } from "vitest";
import type { MonthlyPerformanceRow, MonthlyPositionDetail } from "./types";
import { attributeReturns } from "./attribution";

const SECTORS: Record<string, string> = {
  GGAL: "Servicios financieros",
  YPFD: "Energía",
};

function sectorOf(ticker: string): string {
  return SECTORS[ticker] ?? "Sin clasificar";
}

function position(overrides: Partial<MonthlyPositionDetail>): MonthlyPositionDetail {
  return {
    instrumentId: overrides.ticker ?? "id",
    ticker: "GGAL",
    instrumentName: "Grupo Galicia",
    instrumentType: "STOCK_AR",
    quantity: 1,
    priceArs: 0,
    valueArs: 0,
    valueUsd: 0,
    costBasisArs: 0,
    unrealizedPnlArs: 0,
    unrealizedReturnPct: null,
    costBasisUsd: null,
    unrealizedPnlUsd: null,
    unrealizedReturnPctUsd: null,
    priceIsStale: false,
    priceIsLive: false,
    monthGainArs: 0,
    monthReturnPct: null,
    monthGainUsd: null,
    monthReturnPctUsd: null,
    ...overrides,
  };
}

function month(
  key: string,
  positions: MonthlyPositionDetail[],
  overrides: Partial<MonthlyPerformanceRow> = {}
): MonthlyPerformanceRow {
  const gainArs = positions.reduce((sum, p) => sum + p.monthGainArs, 0) + (overrides.incomeArs ?? 0);
  const gainUsd =
    positions.reduce((sum, p) => sum + (p.monthGainUsd ?? 0), 0) + (overrides.incomeUsd ?? 0);
  return {
    month: key,
    valuationDate: `${key}-28T00:00:00.000Z`,
    cclMonthEnd: 1000,
    valueArs: 0,
    valueUsd: 0,
    netInvestedArs: 0,
    netInvestedUsd: 0,
    cumulativeInvestedArs: 0,
    cumulativeInvestedUsd: 0,
    incomeArs: 0,
    incomeUsd: 0,
    gainArs,
    gainUsd,
    cumulativeGainArs: 0,
    cumulativeGainUsd: 0,
    monthlyReturnArs: null,
    monthlyReturnUsd: null,
    cumulativeReturnArs: null,
    cumulativeReturnUsd: null,
    unrealizedReturnPct: null,
    unrealizedReturnPctUsd: null,
    drawdownArs: 0,
    drawdownUsd: 0,
    positions,
    coverage: "full",
    staleTickers: [],
    ...overrides,
  };
}

describe("attributeReturns — por ticker", () => {
  it("suma la ganancia de cada ticker a través de los meses", () => {
    const rows: MonthlyPerformanceRow[] = [
      month("2026-01", [
        position({ ticker: "GGAL", monthGainArs: 100 }),
        position({ ticker: "YPFD", monthGainArs: 50 }),
      ]),
      month("2026-02", [
        position({ ticker: "GGAL", monthGainArs: 30 }),
        position({ ticker: "YPFD", monthGainArs: -10 }),
      ]),
    ];

    const result = attributeReturns(rows, "ticker", "ARS", sectorOf);
    const ggal = result.rows.find((r) => r.key === "GGAL");
    const ypfd = result.rows.find((r) => r.key === "YPFD");

    expect(ggal?.amount).toBe(130);
    expect(ypfd?.amount).toBe(40);
  });

  it("una posición que solo aparece algunos meses solo suma esos meses", () => {
    const rows: MonthlyPerformanceRow[] = [
      month("2026-01", [position({ ticker: "GGAL", monthGainArs: 100 })]),
      month("2026-02", [
        position({ ticker: "GGAL", monthGainArs: 20 }),
        position({ ticker: "AAPL", monthGainArs: 15 }),
      ]),
    ];

    const result = attributeReturns(rows, "ticker", "ARS", sectorOf);
    expect(result.rows.find((r) => r.key === "GGAL")?.amount).toBe(120);
    expect(result.rows.find((r) => r.key === "AAPL")?.amount).toBe(15);
  });

  it("ordena los grupos por contribución absoluta descendente", () => {
    const rows: MonthlyPerformanceRow[] = [
      month("2026-01", [
        position({ ticker: "GGAL", monthGainArs: 10 }),
        position({ ticker: "YPFD", monthGainArs: -500 }),
        position({ ticker: "AAPL", monthGainArs: 200 }),
      ]),
    ];

    const result = attributeReturns(rows, "ticker", "ARS", sectorOf);
    const groupKeys = result.rows.filter((r) => r.kind === "group").map((r) => r.key);
    expect(groupKeys).toEqual(["YPFD", "AAPL", "GGAL"]);
  });

  it("incluye la fila de renta (dividendos y cupones) por separado de los grupos", () => {
    const rows: MonthlyPerformanceRow[] = [
      month("2026-01", [position({ ticker: "GGAL", monthGainArs: 100 })], { incomeArs: 25 }),
    ];

    const result = attributeReturns(rows, "ticker", "ARS", sectorOf);
    const incomeRow = result.rows.find((r) => r.kind === "income");
    expect(incomeRow?.amount).toBe(25);
    expect(incomeRow?.label).toMatch(/renta/i);
  });
});

describe("attributeReturns — por sector", () => {
  it("agrupa por sector usando el sectorOf provisto", () => {
    const rows: MonthlyPerformanceRow[] = [
      month("2026-01", [
        position({ ticker: "GGAL", monthGainArs: 100 }),
        position({ ticker: "YPFD", monthGainArs: 50 }),
      ]),
    ];

    const result = attributeReturns(rows, "sector", "ARS", sectorOf);
    expect(result.rows.find((r) => r.key === "Servicios financieros")?.amount).toBe(100);
    expect(result.rows.find((r) => r.key === "Energía")?.amount).toBe(50);
  });

  it("un ticker sin sector conocido cae en 'Sin clasificar'", () => {
    const rows: MonthlyPerformanceRow[] = [
      month("2026-01", [position({ ticker: "ZZZZ", monthGainArs: 10 })]),
    ];
    const result = attributeReturns(rows, "sector", "ARS", sectorOf);
    expect(result.rows.find((r) => r.key === "Sin clasificar")?.amount).toBe(10);
  });
});

describe("attributeReturns — reconciliación", () => {
  it("sin residual (ARS: Σ posiciones + renta == ganancia del período), no hay fila de reconciliación", () => {
    const rows: MonthlyPerformanceRow[] = [
      month("2026-01", [position({ ticker: "GGAL", monthGainArs: 100 })], { incomeArs: 10 }),
    ];
    // gainArs computed by the `month()` helper already equals Σ positions + income (110).
    const result = attributeReturns(rows, "ticker", "ARS", sectorOf);
    expect(result.rows.some((r) => r.kind === "reconciliation")).toBe(false);
    expect(result.total).toBe(110);
  });

  it("con residual (ej. USD con una posición sin CCL), agrega una fila de reconciliación y el total sigue siendo la ganancia del período", () => {
    const rows: MonthlyPerformanceRow[] = [
      month(
        "2026-01",
        [
          position({ ticker: "GGAL", monthGainArs: 100, monthGainUsd: 5 }),
          // Esta posición no tiene monthGainUsd medible (sin CCL para su aporte).
          position({ ticker: "YPFD", monthGainArs: 50, monthGainUsd: null }),
        ],
        { gainUsd: 20 } // la ganancia total en USD del mes SÍ midió el aporte de YPFD; el residual es 20 - 5 = 15.
      ),
    ];

    const result = attributeReturns(rows, "ticker", "USD", sectorOf);
    const reconciliation = result.rows.find((r) => r.kind === "reconciliation");
    expect(reconciliation).toBeDefined();
    expect(reconciliation?.amount).toBeCloseTo(15, 5);
    expect(result.total).toBe(20);

    const sumOfRows = result.rows.reduce((sum, r) => sum + r.amount, 0);
    expect(sumOfRows).toBeCloseTo(result.total, 5);
  });

  it("un residual menor o igual a 0.5 no genera fila de reconciliación", () => {
    const rows: MonthlyPerformanceRow[] = [
      month("2026-01", [position({ ticker: "GGAL", monthGainArs: 100 })], {
        gainArs: 100.5,
      }),
    ];
    const result = attributeReturns(rows, "ticker", "ARS", sectorOf);
    expect(result.rows.some((r) => r.kind === "reconciliation")).toBe(false);
  });

  it("un residual mayor a 0.5 sí genera fila de reconciliación", () => {
    const rows: MonthlyPerformanceRow[] = [
      month("2026-01", [position({ ticker: "GGAL", monthGainArs: 100 })], {
        gainArs: 100.51,
      }),
    ];
    const result = attributeReturns(rows, "ticker", "ARS", sectorOf);
    expect(result.rows.some((r) => r.kind === "reconciliation")).toBe(true);
  });

  it("el total siempre es la ganancia del período, la misma métrica que 'Ganancia del período'", () => {
    const rows: MonthlyPerformanceRow[] = [
      month("2026-01", [position({ ticker: "GGAL", monthGainArs: 100 })], { incomeArs: 10 }),
      month("2026-02", [position({ ticker: "GGAL", monthGainArs: -20 })], { incomeArs: 5 }),
    ];
    const periodGain = rows.reduce((sum, row) => sum + row.gainArs, 0);
    const result = attributeReturns(rows, "ticker", "ARS", sectorOf);
    expect(result.total).toBe(periodGain);
  });
});

describe("attributeReturns — casos vacíos", () => {
  it("sin meses, devuelve solo la fila de renta en 0 y total 0", () => {
    const result = attributeReturns([], "ticker", "ARS", sectorOf);
    expect(result.total).toBe(0);
    expect(result.rows.filter((r) => r.kind === "group")).toEqual([]);
    expect(result.rows.find((r) => r.kind === "income")?.amount).toBe(0);
  });
});
