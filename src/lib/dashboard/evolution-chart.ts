import type { EvolutionPoint } from "./evolution";

/** What the evolution chart plots: portfolio value, absolute result, or cumulative return. */
export type ViewMode = "value" | "result" | "percent";

export type AxisCurrency = "ARS" | "USD";

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Etiquetas del eje. En modo Valor/Resultado son plata (con notación compacta, ver
 * abajo); en modo Rendimiento % son puntos porcentuales.
 */
export function formatAxisValue(value: number, currency: AxisCurrency, mode: ViewMode): string {
  if (mode === "percent") {
    return `${value >= 0 ? "+" : ""}${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
  }
  return formatAxisPrice(value, currency);
}

/**
 * Etiquetas del eje de precios.
 *
 * No usa `formatCompact` (el de los charts de recharts) porque redondea a un decimal, y
 * con zoom fino el eje entero termina repitiendo `$4,0 M` en cada tick. Con cifras
 * significativas los valores siguen distinguiéndose al acercarse, que es justo lo que
 * tiene que pasar cuando el eje acompaña al zoom.
 */
function formatAxisPrice(value: number, currency: AxisCurrency): string {
  const prefix = currency === "USD" ? "U$S " : "$";
  const formatted = new Intl.NumberFormat("es-AR", {
    notation: "compact",
    maximumSignificantDigits: 4,
  }).format(value);
  return `${prefix}${formatted}`;
}

/**
 * Primera fecha (ascendente) a partir de la cual ya ningún punto usa precio estimado de
 * ON, para el footnote. `null` si nunca hubo estimación o si el último punto de la
 * serie todavía la usa (no hay "a partir de" que mostrar todavía).
 */
export function estimatedPricesCutoff(
  points: Array<Pick<EvolutionPoint, "date" | "hasEstimatedPrices">>
): string | null {
  let lastEstimatedIndex = -1;
  points.forEach((point, index) => {
    if (point.hasEstimatedPrices) lastEstimatedIndex = index;
  });
  if (lastEstimatedIndex === -1) return null;
  return points[lastEstimatedIndex + 1]?.date ?? null;
}

export function formatDayMonth(value: string): string {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
    new Date(value)
  );
}
