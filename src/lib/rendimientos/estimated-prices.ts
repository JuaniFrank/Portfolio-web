/**
 * Meses con precios de ON estimados (valor técnico, no cotización real).
 *
 * Mismo aviso que el gráfico de evolución (`estimatedPricesCutoff`), pero por mes:
 * `/rendimientos` valúa al cierre de cada mes, así que alcanza con saber en cuáles hubo
 * una posición valuada con precio estimado.
 */

/** Meses (en el orden recibido) cuyo cierre tiene alguna posición con precio estimado. */
export function monthsWithEstimatedPrices(
  months: Array<{ month: string; positions: Array<{ priceEstimated?: boolean }> }>
): string[] {
  return months
    .filter((row) => row.positions.some((position) => position.priceEstimated))
    .map((row) => row.month);
}

/** De los meses estimados, los que caen dentro del período que se está mirando. */
export function estimatedMonthsInPeriod(
  estimatedMonths: string[],
  monthsInPeriod: Array<{ month: string }>
): string[] {
  const visible = new Set(monthsInPeriod.map((row) => row.month));
  return estimatedMonths.filter((month) => visible.has(month));
}
