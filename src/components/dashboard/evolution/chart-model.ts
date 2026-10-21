import type { EvolutionInstrument, EvolutionMover } from "@/lib/dashboard/evolution";
import type { EvolutionTradeMarker, ViewRow } from "@/lib/dashboard/evolution-view";
import type { ViewMode } from "@/lib/dashboard/evolution-chart";

export const HEIGHT = 340;

/** Ancho del tooltip flotante. Fijo para poder decidir de qué lado del cursor va. */
export const TOOLTIP_WIDTH = 380;
export const CURSOR_OFFSET = 16;

export const ASSET_TYPE_ORDER: EvolutionInstrument["type"][] = ["STOCK_AR", "CEDEAR", "ON"];
export const ASSET_TYPE_LABELS: Record<EvolutionInstrument["type"], string> = {
  STOCK_AR: "Acciones",
  CEDEAR: "CEDEARs",
  ON: "ONs",
};

export const MODE_OPTIONS: Array<{ id: ViewMode; label: string }> = [
  { id: "value", label: "Valor" },
  { id: "result", label: "Resultado" },
  { id: "percent", label: "Rendimiento %" },
];

/** Fila del chart: el valor a graficar según el modo, más todo lo que necesita el
 * tooltip — ya filtrado a la selección vigente. */
export type ChartRow = {
  date: string;
  chartValue: number;
  view: ViewRow;
  /** `value(t) - value(t-1) - flujo(t)`, o 0 en el primer punto: mismo criterio que
   * `changeArs` en `evolution.ts`, aplicado a la selección. */
  periodChange: number;
  gainers: EvolutionMover[];
  losers: EvolutionMover[];
  staleTickers: string[];
  trade: EvolutionTradeMarker | null;
};

export type Hovered = { row: ChartRow; x: number; y: number };
