/**
 * Serie histórica del CCL (USD/ARS), leída una vez y consultada as-of por fecha.
 *
 * Existe porque medir en dólares no es dividir por el dólar de hoy. Una compra hecha
 * hace tres meses costó los dólares que costó *ese* día; si se la convierte al CCL de
 * hoy, el tipo de cambio aparece en el costo y en el valor y se cancela, y el
 * rendimiento en dólares termina siendo una copia exacta del de pesos. En un país donde
 * el CCL se mueve tanto como los papeles, esa igualdad esconde justamente el dato que
 * se quería ver.
 *
 * La fuente es la misma que llena `FxRate` con `source = "CCL"`: `syncCclHistory`
 * (argentinadatos) para el histórico y `resolveCclRate` para el día de hoy.
 */

import { prisma } from "@/lib/prisma";
import { TimeSeries } from "@/lib/rendimientos/price-series";

/** Lookup del CCL vigente a una fecha, con arrastre desde la última rueda con dato. */
export type CclLookup = (date: Date) => number | null;

export async function loadCclSeries(): Promise<TimeSeries> {
  const rows = await prisma.fxRate.findMany({
    where: { baseCurrencyCode: "USD", quoteCurrencyCode: "ARS", source: "CCL" },
    orderBy: { date: "asc" },
    select: { date: true, mid: true },
  });

  return new TimeSeries(rows.map((row) => ({ date: row.date, value: Number(row.mid) })));
}

/**
 * Adapta la serie a la función que esperan los replays de posiciones.
 *
 * Devuelve `null` para fechas anteriores al primer dato en vez de extrapolar: un CCL
 * inventado hacia atrás es peor que un costo en dólares que se admite desconocido.
 */
export function cclLookupFrom(series: TimeSeries): CclLookup {
  return (date: Date) => series.asOf(date)?.value ?? null;
}
