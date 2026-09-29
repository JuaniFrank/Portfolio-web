/**
 * Avisos de calidad de datos del dashboard: lo que hoy vive disperso en footnotes
 * (CCL faltante, precios arrastrados, valores estimados de ON, concentración) se junta
 * acá en una sola lista para el panel "Hoy". Vacía cuando no hay nada que reportar —
 * la UI la oculta en ese caso.
 */
import type { EvolutionPoint } from "./evolution";
import type { ConcentrationStats, DashboardHolding } from "./types";

export type DashboardNoticeSeverity = "warning" | "info";

export type DashboardNotice = {
  id: string;
  severity: DashboardNoticeSeverity;
  title: string;
  detail: string;
};

/** Encima de este peso individual, una posición domina el portfolio. */
const TOP_HOLDING_THRESHOLD = 25;
/** Encima de esta suma, las 5 principales posiciones concentran el portfolio aunque
 * ninguna sola pase el umbral individual. */
const TOP5_THRESHOLD = 70;

export function buildDashboardNotices(args: {
  cclMissing: boolean;
  lastPoint: EvolutionPoint | null;
  concentration: ConcentrationStats;
  holdings?: DashboardHolding[];
}): DashboardNotice[] {
  const { cclMissing, lastPoint, concentration } = args;
  const notices: DashboardNotice[] = [];

  if (cclMissing) {
    notices.push({
      id: "ccl-missing",
      severity: "warning",
      title: "Falta la cotización del CCL",
      detail:
        "No hay CCL cargado: las métricas en dólares aparecen en cero. Importá o registrá un tipo de cambio USD/ARS para habilitarlas.",
    });
  }

  if (lastPoint && lastPoint.staleTickers.length > 0) {
    notices.push({
      id: "stale-tickers",
      severity: "warning",
      title: "Precios desactualizados",
      detail: `${lastPoint.staleTickers.join(", ")}: sin cierre propio del último período, valuados al último precio conocido.`,
    });
  }

  if (lastPoint && lastPoint.hasEstimatedPrices) {
    const estimatedTickers = lastPoint.positions
      .filter((position) => position.priceEstimated)
      .map((position) => position.ticker);
    if (estimatedTickers.length > 0) {
      notices.push({
        id: "estimated-on",
        severity: "info",
        title: "Valores estimados de ON",
        detail: `${estimatedTickers.join(", ")}: sin cotización ese día, valuados con el precio técnico estimado.`,
      });
    }
  }

  const topHoldingPercent = Number(concentration.topHoldingPercent);
  const top5Percent = Number(concentration.top5Percent);

  if (concentration.topHoldingTicker && topHoldingPercent > TOP_HOLDING_THRESHOLD) {
    notices.push({
      id: "concentration",
      severity: "info",
      title: "Concentración alta en una posición",
      detail: `${concentration.topHoldingTicker} representa el ${concentration.topHoldingPercent}% del portfolio.`,
    });
  } else if (top5Percent > TOP5_THRESHOLD) {
    notices.push({
      id: "concentration",
      severity: "info",
      title: "Concentración alta en las principales posiciones",
      detail: `Tus 5 posiciones más grandes suman el ${concentration.top5Percent}% del portfolio.`,
    });
  }

  return notices;
}
