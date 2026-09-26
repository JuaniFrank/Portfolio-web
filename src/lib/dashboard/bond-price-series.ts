/**
 * Precio diario ARS/VN de una ON para el replay del dashboard. **Módulo puro.**
 *
 * `data912` solo tiene snapshots intradía desde 2026-09-17 (`PriceCache.source =
 * "data912"`), cotizados en ARS por 100 VN (`VN_QUOTE_BASIS`, ver `bonds/valuation.ts`).
 * Para el resto del histórico — y para cualquier día sin snapshot — no hay precio de
 * mercado en ningún lado. Este módulo resuelve las dos situaciones con el mismo shape
 * de salida:
 *
 *   - **Cierre real**: el último snapshot del día, dividido por `VN_QUOTE_BASIS` para
 *     pasar de "ARS por 100 VN" a "ARS por VN" — la misma unidad que `valuatePortfolioAt`
 *     multiplica por la cantidad nominal en VN (ver `evolution-data.ts`).
 *   - **Valor técnico estimado**: sin snapshot, se estima como fracción residual del
 *     valor nominal (después de amortizaciones, según el schedule resuelto) × USD 1 por
 *     VN (el hard-dollar de compra) × el CCL del día. Es deliberadamente burdo — ignora
 *     interés corrido y cualquier riesgo de crédito/duración — así que cada punto viene
 *     marcado `estimated: true` para que la UI pueda aclararlo.
 *
 * Días sin cierre real y sin CCL disponible (ni siquiera arrastrado) se omiten del
 * resultado: no hay ninguna base para inventar un precio, y el consumidor (`PriceIndex`)
 * ya sabe arrastrar el último punto conocido para los días que faltan.
 */

import { toUtcDay } from "@/lib/rendimientos/months";
import type { TimeSeries } from "@/lib/rendimientos/price-series";
import { VN_QUOTE_BASIS } from "@/lib/bonds/valuation";

/** Snapshot intradía crudo, tal como se lee de `PriceCache` (`source: "data912"`). */
export type BondRealSnapshot = {
  datetime: Date;
  /** ARS por 100 VN. */
  close: number;
};

/**
 * Una fila del schedule resuelto (`resolveBondSchedule`), reducida a lo que este
 * módulo necesita: cuánto valor nominal queda (0–100, par = 100) una vez aplicado el
 * pago de esa fecha.
 */
export type BondResidualRow = {
  /** YYYY-MM-DD. */
  paymentDate: string;
  /** Residual 0–100 después de este pago (mismo basis que `BondScheduleRow`). */
  residualValue: number;
};

export type BondDailyPrice = {
  /** YYYY-MM-DD. */
  date: string;
  /** ARS por VN — la unidad que espera `valuatePortfolioAt`. */
  priceArsPerVn: number;
  /** `true` cuando el precio es el valor técnico estimado, no un cierre medido. */
  estimated: boolean;
};

/** Par de compra: las dos ONs conocidas se compraron hard-dollar a USD 1 por VN. */
const PAR_USD_PER_VN = 1;

/**
 * Fracción residual (0–1) vigente en `day`, según el schedule resuelto.
 *
 * Antes de la primera fila (o sin schedule) el residual es 1: todavía no hubo
 * amortizaciones. De ahí en más, la fila aplicable es la última con `paymentDate <= day`.
 */
function residualFractionAt(schedule: BondResidualRow[], day: Date): number {
  if (schedule.length === 0) return 1;

  const sorted = [...schedule].sort(
    (a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime()
  );

  const dayTime = day.getTime();
  let residual = 100;
  for (const row of sorted) {
    if (new Date(row.paymentDate).getTime() > dayTime) break;
    residual = row.residualValue;
  }
  return residual / 100;
}

/** Último snapshot (por timestamp, no por orden de array) del día local de `day`. */
function lastSnapshotOfDay(snapshots: BondRealSnapshot[], day: Date): number | null {
  const dayTime = toUtcDay(day).getTime();
  let latest: BondRealSnapshot | null = null;

  for (const snapshot of snapshots) {
    if (toUtcDay(snapshot.datetime).getTime() !== dayTime) continue;
    if (!latest || snapshot.datetime.getTime() > latest.datetime.getTime()) {
      latest = snapshot;
    }
  }

  return latest ? latest.close : null;
}

export function buildBondDailyPriceSeries(params: {
  /** Días a cubrir, en cualquier orden. */
  days: Date[];
  /** Snapshots intradía crudos, cualquier orden. */
  snapshots: BondRealSnapshot[];
  /** Schedule resuelto (`resolveBondSchedule`), reducido a residual por fecha. */
  schedule: BondResidualRow[];
  /** CCL histórico, ya cargado — se comparte con el resto del loader. */
  ccl: TimeSeries;
}): BondDailyPrice[] {
  const { days, snapshots, schedule, ccl } = params;

  const points: BondDailyPrice[] = [];

  for (const day of days) {
    const date = toUtcDay(day).toISOString().slice(0, 10);
    const realClose = lastSnapshotOfDay(snapshots, day);

    if (realClose !== null) {
      points.push({ date, priceArsPerVn: realClose / VN_QUOTE_BASIS, estimated: false });
      continue;
    }

    const cclHit = ccl.asOf(day);
    if (!cclHit || cclHit.value <= 0) continue;

    const residualFraction = residualFractionAt(schedule, day);
    points.push({
      date,
      priceArsPerVn: residualFraction * PAR_USD_PER_VN * cclHit.value,
      estimated: true,
    });
  }

  return points;
}
