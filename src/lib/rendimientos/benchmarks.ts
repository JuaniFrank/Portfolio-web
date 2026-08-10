/**
 * Construcción de series de benchmark comparables. **Módulo puro.**
 *
 * Dos semánticas de entrada bien distintas, y mezclarlas es un error silencioso:
 *
 *   - **Índices** (MERVAL, S&P 500): `MacroSeries.value` es el **nivel** del índice.
 *     La variación mensual se deriva comparando cierres de fin de mes.
 *   - **Inflación** (IPC_AR): `MacroSeries.value` ya **es** la variación porcentual
 *     mensual publicada por el INDEC. No hay nada que derivar; sí hay que acumular
 *     con producto, no con suma.
 *
 * Regla de comparabilidad: cada benchmark declara su moneda y solo se compara contra
 * la serie del portfolio en esa misma moneda. Comparar un portfolio medido en USD
 * contra el Merval en pesos no dice nada.
 */

import { chainBenchmark } from "./returns";
import { monthEnd, previousMonth, monthKey, type MonthKey } from "./months";
import { TimeSeries } from "./price-series";
import type { BenchmarkKey, BenchmarkPoint, BenchmarkSeries, ViewCurrency } from "./types";

type BenchmarkMeta = {
  label: string;
  currency: ViewCurrency;
  color: string;
};

/** Metadatos de presentación de cada benchmark, en un solo lugar. */
export const BENCHMARK_META: Record<BenchmarkKey, BenchmarkMeta> = {
  IPC_AR: { label: "Inflación", currency: "ARS", color: "#a855f7" },
  MERVAL: { label: "Merval", currency: "ARS", color: "#f59e0b" },
  SP500: { label: "S&P 500", currency: "USD", color: "#f97316" },
};

/**
 * Benchmark derivado de un índice: variación mensual entre cierres de fin de mes.
 *
 * Usa lookup as-of, así que un fin de mes que cae domingo toma el cierre del viernes.
 * El primer mes del período necesita el cierre del mes anterior; si no está en la
 * serie queda en `null` en vez de asumir que arrancó en cero.
 */
export function buildIndexBenchmark(
  key: BenchmarkKey,
  months: MonthKey[],
  levels: TimeSeries
): BenchmarkSeries {
  const meta = BENCHMARK_META[key];
  const monthlyPercents: Array<number | null> = [];

  for (const month of months) {
    const current = levels.asOf(monthEnd(month));
    const previous = levels.asOf(monthEnd(previousMonth(month)));

    if (!current || !previous || previous.value <= 0) {
      monthlyPercents.push(null);
      continue;
    }
    monthlyPercents.push((current.value / previous.value - 1) * 100);
  }

  return assemble(key, meta, months, monthlyPercents, levels.last?.date ?? null);
}

/**
 * Benchmark de inflación: los valores publicados ya son variaciones mensuales.
 *
 * Se indexa por mes de la fecha publicada. El INDEC fecha cada dato a fin de mes
 * (`2026-06-30` = junio), así que el mes de la fecha es directamente el mes del dato.
 *
 * Los meses sin publicar quedan en `null` y `chainBenchmark` corta el acumulado ahí.
 * Es deliberado: rellenar con 0 % le regalaría rendimiento real al portfolio durante
 * todo el lag de publicación.
 */
export function buildInflationBenchmark(
  months: MonthKey[],
  points: Array<{ date: Date; value: number }>
): BenchmarkSeries {
  const meta = BENCHMARK_META.IPC_AR;

  const byMonth = new Map<MonthKey, number>();
  let lastDate: Date | null = null;
  for (const point of points) {
    if (!Number.isFinite(point.value)) continue;
    byMonth.set(monthKey(point.date), point.value);
    if (!lastDate || point.date.getTime() > lastDate.getTime()) lastDate = point.date;
  }

  const monthlyPercents = months.map((month) => byMonth.get(month) ?? null);
  return assemble("IPC_AR", meta, months, monthlyPercents, lastDate);
}

function assemble(
  key: BenchmarkKey,
  meta: BenchmarkMeta,
  months: MonthKey[],
  monthlyPercents: Array<number | null>,
  lastSourceDate: Date | null
): BenchmarkSeries {
  const cumulativePercents = chainBenchmark(monthlyPercents);

  const points: BenchmarkPoint[] = months.map((month, index) => ({
    month,
    monthlyPercent: monthlyPercents[index] ?? null,
    cumulativePercent: cumulativePercents[index] ?? null,
  }));

  // Último mes DENTRO del período con dato: es lo que la UI necesita para avisar
  // del lag, no la última fecha absoluta de la fuente.
  const lastAvailableMonth =
    [...points].reverse().find((point) => point.monthlyPercent !== null)?.month ?? null;

  return {
    key,
    label: meta.label,
    currency: meta.currency,
    color: meta.color,
    points,
    available: lastSourceDate !== null && points.some((point) => point.monthlyPercent !== null),
    lastAvailableMonth,
  };
}
