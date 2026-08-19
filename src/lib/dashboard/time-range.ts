/**
 * Selección de ventana temporal para series fechadas: presets relativos más un rango
 * personalizado.
 *
 * Los días hacia atrás de cada preset son los mismos que usa `filterBarsByRange`
 * (`@/lib/monitoreo/series`), para que "3M" signifique lo mismo en el dashboard y en
 * `/monitoreo`.
 *
 * Recorta la vista, **no** recalcula los puntos. Cada punto trae su resultado y sus
 * movers medidos contra su cierre anterior en la serie completa; recalcularlos sobre el
 * recorte estaría mal, porque el primer punto visible tuvo un resultado real contra un
 * cierre que la ventana dejó afuera.
 *
 * Todas las fechas son strings `YYYY-MM-DD`, que ordenan lexicográficamente igual que
 * cronológicamente: alcanza con comparar strings y no hay zonas horarias de por medio.
 */

export type RangePreset = "1M" | "3M" | "6M" | "1Y" | "ALL" | "CUSTOM";

export type TimeRange = {
  preset: RangePreset;
  /** Solo se usan con `preset: "CUSTOM"`. `null` deja la ventana abierta de ese lado. */
  from: string | null;
  to: string | null;
};

export const RANGE_PRESETS: Array<{
  id: RangePreset;
  label: string;
  /** Días hacia atrás desde la referencia. `null` = sin límite. */
  days: number | null;
}> = [
  { id: "1M", label: "1M", days: 30 },
  { id: "3M", label: "3M", days: 90 },
  { id: "6M", label: "6M", days: 180 },
  { id: "1Y", label: "1A", days: 365 },
  { id: "ALL", label: "Todo", days: null },
  { id: "CUSTOM", label: "Personalizado", days: null },
];

export const DEFAULT_TIME_RANGE: TimeRange = { preset: "ALL", from: null, to: null };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function subtractDays(day: string, days: number): string {
  const time = new Date(`${day}T00:00:00.000Z`).getTime();
  return new Date(time - days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Ventana `[from, to]` resuelta. `null` en cualquiera de los dos deja ese lado abierto.
 *
 * `referenceDay` es el último cierre de la serie, no "hoy". Si los precios se atrasaran,
 * un "1M" contado desde hoy podría no tocar ningún punto y dejar el gráfico en blanco;
 * contado desde el último dato, siempre muestra el último mes con información.
 */
export function resolveRangeWindow(
  range: TimeRange,
  referenceDay: string
): { from: string | null; to: string | null } {
  if (range.preset === "CUSTOM") {
    const { from, to } = range;
    // El calendario permite marcar el extremo final antes del inicial. Se ordena en vez
    // de devolver una ventana vacía, que se vería como un gráfico roto.
    if (from && to && from > to) return { from: to, to: from };
    return { from, to };
  }

  const days = RANGE_PRESETS.find((option) => option.id === range.preset)?.days ?? null;
  if (days === null) return { from: null, to: null };

  return { from: subtractDays(referenceDay, days), to: referenceDay };
}

/** Recorta una serie fechada a la ventana, extremos incluidos. */
export function sliceByRange<T extends { date: string }>(
  points: T[],
  range: TimeRange,
  referenceDay: string
): T[] {
  const { from, to } = resolveRangeWindow(range, referenceDay);
  if (from === null && to === null) return points;

  return points.filter(
    (point) => (from === null || point.date >= from) && (to === null || point.date <= to)
  );
}

/**
 * Extremos con dato de la serie, para acotar lo que el calendario deja elegir.
 *
 * Sin esto se puede seleccionar un rango sin ningún cierre adentro y el gráfico queda
 * vacío sin explicación.
 */
export function clampToSeries(points: Array<{ date: string }>): {
  min: string | null;
  max: string | null;
} {
  if (points.length === 0) return { min: null, max: null };
  return { min: points[0]!.date, max: points.at(-1)!.date };
}
