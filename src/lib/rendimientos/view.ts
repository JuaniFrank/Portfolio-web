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
  MonthlyPositionDetail,
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
  cumulativeInvested: number;
  netInvested: number;
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
      cumulativeInvested: isArs ? row.cumulativeInvestedArs : row.cumulativeInvestedUsd,
      netInvested: isArs ? row.netInvestedArs : row.netInvestedUsd,
      gain,
      cumulativeGain,
      monthlyReturn: monthlyReturns[index] ?? null,
      cumulativeReturn: cumulativeReturns[index] ?? null,
      // Cada moneda tiene su propio no realizado: el de dólares mide el costo al CCL de
      // cada compra contra el valor al CCL del cierre.
      unrealizedReturn: isArs ? row.unrealizedReturnPct : row.unrealizedReturnPctUsd,
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
      netInvestedArs: 0,
      netInvestedUsd: 0,
      annualizedReturnArs: null,
      annualizedReturnUsd: null,
      maxDrawdownArs: 0,
      maxDrawdownUsd: 0,
      bestMonth: null,
      worstMonth: null,
      monthsTracked: 0,
    };
  }

  // Ganancia y capital invertido del período = suma de los meses visibles, no el
  // acumulado global que arrastra todo lo anterior a la ventana.
  const periodGain = rows.reduce((total, row) => total + row.gain, 0);
  const periodInvested = rows.reduce((total, row) => total + row.netInvested, 0);
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
    netInvestedArs: isArs ? periodInvested : 0,
    netInvestedUsd: isArs ? 0 : periodInvested,
    annualizedReturnArs: isArs ? annualizeReturn(cumulativeReturn, measuredMonths) : null,
    annualizedReturnUsd: isArs ? null : annualizeReturn(cumulativeReturn, measuredMonths),
    maxDrawdownArs: isArs ? maxDrawdown : 0,
    maxDrawdownUsd: isArs ? 0 : maxDrawdown,
    bestMonth: extremes.best,
    worstMonth: extremes.worst,
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
    netInvested: isArs ? summary.netInvestedArs : summary.netInvestedUsd,
    annualizedReturn: isArs ? summary.annualizedReturnArs : summary.annualizedReturnUsd,
    maxDrawdown: isArs ? summary.maxDrawdownArs : summary.maxDrawdownUsd,
    bestMonth: summary.bestMonth,
    worstMonth: summary.worstMonth,
    monthsTracked: summary.monthsTracked,
  };
}

/** Las cifras de una fila de posición, ya resueltas a la moneda activa. */
export type PositionFigures = {
  /** `null` cuando no se puede expresar en la moneda pedida. */
  price: number | null;
  value: number;
  costBasis: number | null;
  unrealizedPnl: number | null;
  unrealizedReturnPct: number | null;
  monthGain: number | null;
  monthReturnPct: number | null;
};

/**
 * Resuelve una fila de posición a la moneda elegida.
 *
 * En dólares no se convierte nada acá: el motor ya trae el costo al CCL del día de cada
 * compra y el valor al CCL del cierre. Dividir las cifras en pesos por un único tipo de
 * cambio sería el bug que esto evita — el porcentaje saldría idéntico al de pesos.
 *
 * El precio en dólares se deriva del valor de la posición en vez de guardarse aparte:
 * es el mismo cociente y evita arrastrar el CCL de cada cierre hasta la UI.
 */
export function positionFigures(
  position: MonthlyPositionDetail,
  currency: ViewCurrency
): PositionFigures {
  if (currency === "ARS") {
    return {
      price: position.priceArs,
      value: position.valueArs,
      costBasis: position.costBasisArs,
      unrealizedPnl: position.unrealizedPnlArs,
      unrealizedReturnPct: position.unrealizedReturnPct,
      monthGain: position.monthGainArs,
      monthReturnPct: position.monthReturnPct,
    };
  }

  return {
    price: position.quantity > 0 ? position.valueUsd / position.quantity : null,
    value: position.valueUsd,
    costBasis: position.costBasisUsd,
    unrealizedPnl: position.unrealizedPnlUsd,
    unrealizedReturnPct: position.unrealizedReturnPctUsd,
    monthGain: position.monthGainUsd,
    monthReturnPct: position.monthReturnPctUsd,
  };
}
