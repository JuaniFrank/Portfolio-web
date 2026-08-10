import { formatMonthLabel, formatMonthLong } from "@/lib/rendimientos/months";

export function formatDateTick(value: string): string {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", timeZone: "UTC" })
    .format(new Date(value))
    .replace(".", "");
}

export function formatDateLong(value: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(value))
    .replace(".", "");
}

export function formatPercentValue(value: number): string {
  return `${value.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}

export function formatSignedPercentValue(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatPercentValue(value)}%`;
}

/** `"2026-08"` → `"08/2026"`. Reexportado para que los charts no importen de `lib`. */
export const formatMonthTick = formatMonthLabel;

/** `"2026-08"` → `"Agosto 2026"`, para tooltips. */
export const formatMonthTooltip = formatMonthLong;

/** Placeholder de "sin dato". Nunca un cero: un cero afirma algo que no sabemos. */
export const EMPTY_VALUE = "—";

export function formatSignedPercentOrEmpty(value: number | null): string {
  return value === null ? EMPTY_VALUE : formatSignedPercentValue(value);
}

/** Verde si sube, rojo si baja, gris si no hay dato. */
export function returnToneClass(value: number | null): string {
  if (value === null) return "text-zinc-500";
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-400";
  return "text-zinc-300";
}

/** Paleta compartida por los charts de rendimientos. */
export const SERIES_COLORS = {
  portfolio: "#6366f1",
  contributions: "#f59e0b",
  positive: "#10b981",
  negative: "#f43f5e",
  drawdown: "#f43f5e",
} as const;

/** Estilo del contenedor de tooltip de recharts, idéntico en todos los charts. */
export const TOOLTIP_CLASS =
  "rounded-lg border border-[#27272a] bg-[#09090b] p-3 text-xs shadow-xl";
