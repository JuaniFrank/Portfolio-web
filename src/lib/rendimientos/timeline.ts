/**
 * Bucketing temporal para series reconstruidas: día a día, semana a semana o mes a mes.
 *
 * Todo en UTC, por la misma razón que `months.ts`: `tradeDate` se guarda con hora
 * (mediodía UTC en los imports) y los precios EOD son medianoche UTC. Comparar
 * instantes en vez de días desplaza operaciones de bucket.
 *
 * Dos decisiones que hacen a la lectura del gráfico:
 *
 * 1. **El último bucket se recorta a `to`, no se proyecta.** El motor mensual valúa
 *    al `monthEnd` incluso cuando el mes está a mitad de camino (hoy 19, valúa al 31)
 *    porque solo le importa la etiqueta del mes. Un gráfico de evolución sí muestra la
 *    fecha, así que un punto rotulado 31/08 con el valor del 19/08 miente.
 * 2. **La semana cierra el domingo** (ISO), no a los 7 días del inicio del rango: así
 *    los buckets son estables y no se corren si cambia la primera operación.
 */

export type Granularity = "daily" | "weekly" | "monthly";

export const GRANULARITIES: Array<{ id: Granularity; label: string }> = [
  { id: "daily", label: "Diario" },
  { id: "weekly", label: "Semanal" },
  { id: "monthly", label: "Mensual" },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Días UTC consecutivos entre `from` y `to`, ambos extremos incluidos. */
export function enumerateUtcDays(from: Date, to: Date): Date[] {
  const start = toUtcMidnight(from);
  const end = toUtcMidnight(to);
  if (start.getTime() > end.getTime()) return [];

  const days: Date[] = [];
  for (let time = start.getTime(); time <= end.getTime(); time += MS_PER_DAY) {
    days.push(new Date(time));
  }
  return days;
}

/**
 * Identificador del bucket al que pertenece un día.
 *
 * - `daily`: el día.
 * - `weekly`: el domingo que cierra su semana ISO. Se usa el cierre y no el inicio del
 *   rango para que los buckets sean estables: si cambia la primera operación, las
 *   semanas no se corren.
 * - `monthly`: su mes.
 */
function bucketKeyOf(day: Date, granularity: Granularity): string {
  if (granularity === "daily") return day.toISOString().slice(0, 10);

  if (granularity === "weekly") {
    const daysToSunday = (7 - day.getUTCDay()) % 7;
    return new Date(day.getTime() + daysToSunday * MS_PER_DAY).toISOString().slice(0, 10);
  }

  return day.toISOString().slice(0, 7);
}

/**
 * Agrupa una lista de días y devuelve el **último día de cada bucket**.
 *
 * Pensado para recibir solo los días con dato (ruedas): así el cierre de cada bucket cae
 * sobre un día que realmente tiene precio. Si el cierre fuera la fecha de calendario, un
 * fin de mes en domingo valuaría con precios arrastrados del viernes y todo el bucket
 * quedaría marcado como incompleto sin que falte nada.
 *
 * Asume `days` ordenado ascendente y sin duplicados.
 */
export function bucketByLastDay(days: Date[], granularity: Granularity): Date[] {
  if (days.length === 0) return [];
  if (granularity === "daily") return [...days];

  const lastByBucket = new Map<string, Date>();
  for (const day of days) lastByBucket.set(bucketKeyOf(day, granularity), day);

  return [...lastByBucket.values()];
}

/**
 * Fechas de cierre de cada bucket del rango, sobre el calendario completo.
 *
 * Siempre termina en `to`, incluso si su bucket quedó incompleto: es el punto "hoy" del
 * gráfico y omitirlo dejaría la serie cortada en el último cierre completo.
 */
export function bucketEndpoints(from: Date, to: Date, granularity: Granularity): Date[] {
  return bucketByLastDay(enumerateUtcDays(from, to), granularity);
}
