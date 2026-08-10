import { describe, expect, it } from "vitest";
import type {
  BenchmarkSeries,
  MonthlyPerformanceRow,
  PerformanceReport,
} from "./types";
import {
  benchmarkCumulativeKey,
  benchmarkMonthlyKey,
  resolveView,
  sliceMonths,
  visibleBenchmarks,
} from "./view";

function month(
  key: string,
  overrides: Partial<MonthlyPerformanceRow> = {}
): MonthlyPerformanceRow {
  return {
    month: key,
    valuationDate: `${key}-28T00:00:00.000Z`,
    cclMonthEnd: 1500,
    valueArs: 1_000_000,
    valueUsd: 666.67,
    netInvestedArs: 0,
    netInvestedUsd: 0,
    cumulativeInvestedArs: 0,
    cumulativeInvestedUsd: 0,
    incomeArs: 0,
    incomeUsd: 0,
    gainArs: 0,
    gainUsd: 0,
    cumulativeGainArs: 0,
    cumulativeGainUsd: 0,
    monthlyReturnArs: 0,
    monthlyReturnUsd: 0,
    cumulativeReturnArs: 0,
    cumulativeReturnUsd: 0,
    unrealizedReturnPct: 0,
    drawdownArs: 0,
    drawdownUsd: 0,
    positions: [],
    coverage: "full",
    staleTickers: [],
    ...overrides,
  };
}

function report(months: MonthlyPerformanceRow[], benchmarks: BenchmarkSeries[] = []): PerformanceReport {
  return {
    portfolioName: "Test",
    months,
    benchmarks,
    summary: {
      currentValueArs: 0,
      currentValueUsd: 0,
      cumulativeReturnArs: null,
      cumulativeReturnUsd: null,
      cumulativeGainArs: 0,
      cumulativeGainUsd: 0,
      netInvestedArs: 0,
      netInvestedUsd: 0,
      annualizedReturnArs: null,
      annualizedReturnUsd: null,
      maxDrawdownArs: 0,
      maxDrawdownUsd: 0,
      bestMonthArs: null,
      worstMonthArs: null,
      monthsTracked: 0,
    },
    excludedHoldings: [],
    dataQuality: {
      partialMonths: [],
      missingCclMonths: [],
      lastPriceSyncDate: null,
      seriesFloor: null,
    },
  };
}

const TWELVE_MONTHS = [
  "2025-09", "2025-10", "2025-11", "2025-12",
  "2026-01", "2026-02", "2026-03", "2026-04",
  "2026-05", "2026-06", "2026-07", "2026-08",
].map((key) => month(key));

describe("sliceMonths", () => {
  it("devuelve todo con ALL", () => {
    expect(sliceMonths(TWELVE_MONTHS, "ALL")).toHaveLength(12);
  });

  it("toma los últimos 6 meses con 6M", () => {
    const sliced = sliceMonths(TWELVE_MONTHS, "6M");
    expect(sliced).toHaveLength(6);
    expect(sliced[0]!.month).toBe("2026-03");
    expect(sliced.at(-1)!.month).toBe("2026-08");
  });

  it("toma los últimos 12 meses con 1A", () => {
    expect(sliceMonths(TWELVE_MONTHS, "1A")).toHaveLength(12);
  });

  it("YTD usa el año del último mes reportado y no el reloj del server", () => {
    // Si la cartera no tiene movimientos hace tiempo, YTD debe seguir mostrando el
    // año de los datos en vez de devolver una lista vacía.
    const sliced = sliceMonths(TWELVE_MONTHS, "YTD");
    expect(sliced).toHaveLength(8);
    expect(sliced.every((row) => row.month.startsWith("2026"))).toBe(true);
  });

  it("no rompe con serie vacía", () => {
    expect(sliceMonths([], "6M")).toEqual([]);
  });

  it("no falla si hay menos meses que el período pedido", () => {
    expect(sliceMonths(TWELVE_MONTHS.slice(0, 2), "1A")).toHaveLength(2);
  });
});

describe("resolveView", () => {
  it("REENCADENA el acumulado dentro de la ventana en vez de recortarlo", () => {
    // El motor reporta acumulados globales; al pedir 6M el primer mes visible tiene
    // que arrancar el acumulado de nuevo, no heredar lo anterior a la ventana.
    const months = [
      month("2026-01", { monthlyReturnArs: 50, cumulativeReturnArs: 50 }),
      month("2026-02", { monthlyReturnArs: 10, cumulativeReturnArs: 65 }),
      month("2026-03", { monthlyReturnArs: 10, cumulativeReturnArs: 81.5 }),
    ];
    const view = resolveView(report(months), "ARS", "6M");
    // Solo los meses visibles: 1,10 × 1,10 = 21 %, sin el +50 % de enero... pero
    // acá los 3 meses son visibles, así que sí incluye enero.
    expect(view.rows.at(-1)!.cumulativeReturn).toBeCloseTo(81.5, 6);

    const shortView = resolveView(report(months.slice(1)), "ARS", "ALL");
    expect(shortView.rows.at(-1)!.cumulativeReturn).toBeCloseTo(21, 6);
  });

  it("recalcula el resumen sobre el período visible", () => {
    const months = [
      month("2026-01", { monthlyReturnArs: 10, gainArs: 100, netInvestedArs: 1000 }),
      month("2026-02", { monthlyReturnArs: 10, gainArs: 200, netInvestedArs: 500 }),
    ];
    const view = resolveView(report(months), "ARS", "ALL");
    expect(view.summary.cumulativeGainArs).toBeCloseTo(300, 6);
    expect(view.summary.netInvestedArs).toBeCloseTo(1500, 6);
    expect(view.summary.monthsTracked).toBe(2);
  });

  it("resuelve la moneda elegida", () => {
    const months = [month("2026-01", { valueArs: 1_500_000, valueUsd: 1000 })];
    expect(resolveView(report(months), "ARS", "ALL").rows[0]!.value).toBe(1_500_000);
    expect(resolveView(report(months), "USD", "ALL").rows[0]!.value).toBe(1000);
  });

  it("solo incluye benchmarks de la moneda activa", () => {
    const merval: BenchmarkSeries = {
      key: "MERVAL",
      label: "Merval",
      currency: "ARS",
      color: "#f59e0b",
      available: true,
      lastAvailableMonth: "2026-02",
      points: [
        { month: "2026-01", monthlyPercent: 5, cumulativePercent: 5 },
        { month: "2026-02", monthlyPercent: 5, cumulativePercent: 10.25 },
      ],
    };
    const sp500: BenchmarkSeries = { ...merval, key: "SP500", label: "S&P 500", currency: "USD" };

    const months = [month("2026-01"), month("2026-02")];
    const arsView = resolveView(report(months, [merval, sp500]), "ARS", "ALL");
    expect(arsView.benchmarks.map((series) => series.key)).toEqual(["MERVAL"]);

    const usdView = resolveView(report(months, [merval, sp500]), "USD", "ALL");
    expect(usdView.benchmarks.map((series) => series.key)).toEqual(["SP500"]);
  });

  it("expone los benchmarks como claves planas para recharts", () => {
    const merval: BenchmarkSeries = {
      key: "MERVAL",
      label: "Merval",
      currency: "ARS",
      color: "#f59e0b",
      available: true,
      lastAvailableMonth: "2026-01",
      points: [{ month: "2026-01", monthlyPercent: 5, cumulativePercent: 5 }],
    };
    const view = resolveView(report([month("2026-01")], [merval]), "ARS", "ALL");
    expect(view.rows[0]![benchmarkMonthlyKey("MERVAL")]).toBe(5);
    expect(view.rows[0]![benchmarkCumulativeKey("MERVAL")]).toBeCloseTo(5, 6);
  });

  it("reencadena el benchmark dentro de la ventana", () => {
    const merval: BenchmarkSeries = {
      key: "MERVAL",
      label: "Merval",
      currency: "ARS",
      color: "#f59e0b",
      available: true,
      lastAvailableMonth: "2026-03",
      points: [
        { month: "2026-01", monthlyPercent: 100, cumulativePercent: 100 },
        { month: "2026-02", monthlyPercent: 10, cumulativePercent: 120 },
        { month: "2026-03", monthlyPercent: 10, cumulativePercent: 142 },
      ],
    };
    // Ventana de 2 meses: el acumulado del benchmark arranca en febrero.
    const months = [month("2026-02"), month("2026-03")];
    const view = resolveView(report(months, [merval]), "ARS", "ALL");
    expect(view.rows.at(-1)![benchmarkCumulativeKey("MERVAL")]).toBeCloseTo(21, 6);
  });

  it("devuelve una vista vacía sin reventar cuando no hay meses", () => {
    const view = resolveView(report([]), "ARS", "ALL");
    expect(view.rows).toEqual([]);
    expect(view.summary.monthsTracked).toBe(0);
    expect(view.summary.cumulativeReturnArs).toBeNull();
  });

  it("propaga los meses sin rendimiento medible como null", () => {
    const months = [month("2026-01", { monthlyReturnArs: null })];
    const view = resolveView(report(months), "ARS", "ALL");
    expect(view.rows[0]!.monthlyReturn).toBeNull();
    expect(view.rows[0]!.cumulativeReturn).toBeNull();
  });
});

describe("visibleBenchmarks", () => {
  const base: BenchmarkSeries = {
    key: "MERVAL",
    label: "Merval",
    currency: "ARS",
    color: "#f59e0b",
    available: true,
    lastAvailableMonth: "2026-01",
    points: [],
  };

  it("descarta los que no tienen datos", () => {
    expect(visibleBenchmarks([{ ...base, available: false }], "ARS")).toEqual([]);
  });

  it("descarta los de otra moneda", () => {
    expect(visibleBenchmarks([base], "USD")).toEqual([]);
  });
});
