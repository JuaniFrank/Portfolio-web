/**
 * View model del reporte: resuelve moneda y período para la UI. **Módulo puro.**
 *
 * Existe por una razón de correctitud, no de comodidad. Cuando el usuario elige
 * "últimos 6 meses" no alcanza con recortar el array: el rendimiento acumulado y el
 * drawdown tienen que **volver a encadenarse dentro de la ventana**, porque un
 * acumulado que arranca en la primera transacción no es el acumulado de los últimos
 * seis meses. Recortar sin recalcular deja un selector de período decorativo que
 * muestra números de otro período.
 */

import { annualizeReturn, chainBenchmark, chainReturns, drawdownFromCumulative, findExtremeMonths } from "./returns";
import type {
  BenchmarkKey,
  BenchmarkSeries,
  MonthlyPerformanceRow,
  PerformanceReport,
  PerformanceSummary,
  ViewCurrency,
} from "./types";

export type Period = "6M" | "1A" | "YTD" | "ALL";

export const PERIODS: Array<{ id: Period; label: string }> = [
  { id: "6M", label: "6M" },
  { id: "1A", label: "1A" },
  { id: "YTD", label: "YTD" },
  { id: "ALL", label: "Todo" },
];

/** Fila lista para recharts. Las claves de benchmark se agregan dinámicamente. */
export type MonthlyChartRow = {
  month: string;
  value: number;
  cumulativeFlow: number;
  netFlow: number;
  gain: number;
  /** Ganancia acumulada **dentro del período visible**, no desde la primera transacción. */
  cumulativeGain: number;
  monthlyReturn: number | null;
  cumulativeReturn: number | null;
  unrealizedReturn: number | null;
  drawdown: number;
  cclMonthEnd: number | null;
  coverage: MonthlyPerformanceRow["coverage"];
} & Record<string, unknown>;

export function benchmarkMonthlyKey(key: BenchmarkKey): string {
  return `monthly_${key}`;
}

export function benchmarkCumulativeKey(key: BenchmarkKey): string {
  return `cumulative_${key}`;
}

/**
 * Recorta la serie al período elegido.
 *
 * `YTD` usa el año del último mes reportado, no el del reloj del server: si la
 * cartera no tiene movimientos hace meses, "en lo que va del año" debe seguir
 * refiriéndose al año de los datos y no devolver una lista vacía.
 */
export function sliceMonths(
  months: MonthlyPerformanceRow[],
  period: Period
): MonthlyPerformanceRow[] {
  if (period === "ALL" || months.length === 0) return months;

  const lastMonth = months.at(-1)!.month;

  if (period === "YTD") {
    const year = lastMonth.slice(0, 4);
    return months.filter((row) => row.month.startsWith(year));
  }

  const count = period === "6M" ? 6 : 12;
  return months.slice(-count);
}

/** Benchmarks comparables con la moneda elegida y con al menos un dato. */
export function visibleBenchmarks(
  benchmarks: BenchmarkSeries[],
  currency: ViewCurrency
): BenchmarkSeries[] {
  return benchmarks.filter((series) => series.currency === currency && series.available);
}

export type ResolvedView = {
  rows: MonthlyChartRow[];
  benchmarks: BenchmarkSeries[];
  summary: PerformanceSummary;
};

/**
 * Resuelve moneda + período a filas graficables, reencadenando todo dentro de la ventana.
 *
 * Los rendimientos **mensuales** se toman tal cual del motor (son independientes del
 * período), pero los **acumulados**, el drawdown y el resumen se recalculan sobre el
 * recorte.
 */
export function resolveView(
  report: PerformanceReport,
  currency: ViewCurrency,
  period: Period
): ResolvedView {
  const months = sliceMonths(report.months, period);
  const isArs = currency === "ARS";

  const monthlyReturns = months.map((row) =>
    isArs ? row.monthlyReturnArs : row.monthlyReturnUsd
  );
  const cumulativeReturns = chainReturns(monthlyReturns);
  const drawdowns = drawdownFromCumulative(cumulativeReturns);

  const benchmarks = visibleBenchmarks(report.benchmarks, currency).map((series) =>
    rechainBenchmark(series, months)
  );

  let cumulativeGain = 0;

  const rows: MonthlyChartRow[] = months.map((row, index) => {
    const gain = isArs ? row.gainArs : row.gainUsd;
    cumulativeGain += gain;

    const chartRow: MonthlyChartRow = {
      month: row.month,
      value: isArs ? row.valueArs : row.valueUsd,
      cumulativeFlow: isArs ? row.cumulativeFlowArs : row.cumulativeFlowUsd,
      netFlow: isArs ? row.netFlowArs : row.netFlowUsd,
      gain,
      cumulativeGain,
      monthlyReturn: monthlyReturns[index] ?? null,
      cumulativeReturn: cumulativeReturns[index] ?? null,
      unrealizedReturn: row.unrealizedReturnPct,
      drawdown: drawdowns[index] ?? 0,
      cclMonthEnd: row.cclMonthEnd,
      coverage: row.coverage,
    };

    for (const series of benchmarks) {
      const point = series.points[index];
      chartRow[benchmarkMonthlyKey(series.key)] = point?.monthlyPercent ?? null;
      chartRow[benchmarkCumulativeKey(series.key)] = point?.cumulativePercent ?? null;
    }

    return chartRow;
  });

  return { rows, benchmarks, summary: summarize(months, rows, currency) };
}

/** Recorta un benchmark a los meses visibles y reencadena su acumulado desde cero. */
function rechainBenchmark(
  series: BenchmarkSeries,
  months: MonthlyPerformanceRow[]
): BenchmarkSeries {
  const visibleMonths = new Set(months.map((row) => row.month));
  const points = series.points.filter((point) => visibleMonths.has(point.month));
  const cumulative = chainBenchmark(points.map((point) => point.monthlyPercent));

  return {
    ...series,
    points: points.map((point, index) => ({
      ...point,
      cumulativePercent: cumulative[index] ?? null,
    })),
    lastAvailableMonth:
      [...points].reverse().find((point) => point.monthlyPercent !== null)?.month ?? null,
  };
}

/** Resumen del período visible, no del histórico completo. */
function summarize(
  months: MonthlyPerformanceRow[],
  rows: MonthlyChartRow[],
  currency: ViewCurrency
): PerformanceSummary {
  const lastMonth = months.at(-1);
  const lastRow = rows.at(-1);
  const isArs = currency === "ARS";

  if (!lastMonth || !lastRow) {
    return {
      currentValueArs: 0,
      currentValueUsd: 0,
      cumulativeReturnArs: null,
      cumulativeReturnUsd: null,
      cumulativeGainArs: 0,
      cumulativeGainUsd: 0,
      netFlowArs: 0,
      netFlowUsd: 0,
      annualizedReturnArs: null,
      annualizedReturnUsd: null,
      maxDrawdownArs: 0,
      maxDrawdownUsd: 0,
      bestMonthArs: null,
      worstMonthArs: null,
      monthsTracked: 0,
    };
  }

  // Ganancia y aportes del período = suma de los meses visibles, no el acumulado
  // global que arrastra todo lo anterior a la ventana.
  const periodGain = rows.reduce((total, row) => total + row.gain, 0);
  const periodFlow = rows.reduce((total, row) => total + row.netFlow, 0);
  const cumulativeReturn = lastRow.cumulativeReturn;
  const measuredMonths = rows.filter((row) => row.monthlyReturn !== null).length;
  const maxDrawdown = Math.min(0, ...rows.map((row) => row.drawdown));
  const extremes = findExtremeMonths(
    rows.map((row) => ({ month: row.month, returnPercent: row.monthlyReturn }))
  );

  return {
    currentValueArs: lastMonth.valueArs,
    currentValueUsd: lastMonth.valueUsd,
    cumulativeReturnArs: isArs ? cumulativeReturn : null,
    cumulativeReturnUsd: isArs ? null : cumulativeReturn,
    cumulativeGainArs: isArs ? periodGain : 0,
    cumulativeGainUsd: isArs ? 0 : periodGain,
    netFlowArs: isArs ? periodFlow : 0,
    netFlowUsd: isArs ? 0 : periodFlow,
    annualizedReturnArs: isArs ? annualizeReturn(cumulativeReturn, measuredMonths) : null,
    annualizedReturnUsd: isArs ? null : annualizeReturn(cumulativeReturn, measuredMonths),
    maxDrawdownArs: isArs ? maxDrawdown : 0,
    maxDrawdownUsd: isArs ? 0 : maxDrawdown,
    bestMonthArs: extremes.best,
    worstMonthArs: extremes.worst,
    monthsTracked: measuredMonths,
  };
}

/** Valores del resumen ya resueltos a la moneda activa, para que la UI no vuelva a elegir. */
export function summaryForCurrency(summary: PerformanceSummary, currency: ViewCurrency) {
  const isArs = currency === "ARS";
  return {
    currentValue: isArs ? summary.currentValueArs : summary.currentValueUsd,
    cumulativeReturn: isArs ? summary.cumulativeReturnArs : summary.cumulativeReturnUsd,
    gain: isArs ? summary.cumulativeGainArs : summary.cumulativeGainUsd,
    netFlow: isArs ? summary.netFlowArs : summary.netFlowUsd,
    annualizedReturn: isArs ? summary.annualizedReturnArs : summary.annualizedReturnUsd,
    maxDrawdown: isArs ? summary.maxDrawdownArs : summary.maxDrawdownUsd,
    bestMonth: summary.bestMonthArs,
    worstMonth: summary.worstMonthArs,
    monthsTracked: summary.monthsTracked,
  };
}
