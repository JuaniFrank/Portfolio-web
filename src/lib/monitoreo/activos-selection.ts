import type { MonitoringInstrument, UiMonitoringSeriesKind } from "./types";

/** `vista` query param: underlying (USD) chart of a CEDEAR, or the CEDEAR itself (ARS). */
export type ActivosView = "subyacente" | "cedear";

export function parseView(value: string | null | undefined): ActivosView | null {
  return value === "subyacente" || value === "cedear" ? value : null;
}

export function kindForView(view: ActivosView | null, isCedear: boolean): UiMonitoringSeriesKind {
  if (!isCedear) return "native";
  return view === "cedear" ? "native" : "cedear-underlying";
}

export function viewForKind(kind: UiMonitoringSeriesKind): ActivosView {
  return kind === "cedear-underlying" ? "subyacente" : "cedear";
}

/**
 * Resolve which instrument/kind to show first: the requested ticker when it exists,
 * otherwise the first instrument in the user's portfolio, otherwise the first one.
 */
export function resolveInitialSelection(
  instruments: MonitoringInstrument[],
  request: { ticker: string | null; vista: ActivosView | null }
): { instrumentId: string; kind: UiMonitoringSeriesKind } | null {
  if (instruments.length === 0) return null;

  const wanted = request.ticker?.trim().toLowerCase();
  const requested = wanted ? instruments.find((i) => i.ticker.toLowerCase() === wanted) : undefined;
  const chosen = requested ?? instruments.find((i) => i.inPortfolio) ?? instruments[0]!;

  return {
    instrumentId: chosen.id,
    kind: kindForView(requested ? request.vista : null, chosen.isCedear),
  };
}

export function buildActivosSearch(
  ticker: string,
  kind: UiMonitoringSeriesKind,
  isCedear: boolean
): string {
  const params = new URLSearchParams({ ticker });
  if (isCedear) params.set("vista", viewForKind(kind));
  return `?${params.toString()}`;
}

/** Instruments held in the portfolio first; relative order is otherwise preserved. */
export function sortInstrumentsPortfolioFirst(
  instruments: MonitoringInstrument[]
): MonitoringInstrument[] {
  return [...instruments].sort((a, b) => Number(b.inPortfolio) - Number(a.inPortfolio));
}
