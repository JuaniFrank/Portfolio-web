/**
 * KPIs de período (Hoy / 7D / 30D / YTD) sobre la serie diaria de evolución.
 *
 * Reusa `buildViewRows`/`summarizeRange` con selección completa (todos los tickers) para
 * que estos números calcen exactamente con la franja de resumen del gráfico de
 * evolución (`SummaryStrip`) cuando el usuario elige el mismo rango a mano — no se
 * reimplementa el TWR acá.
 *
 * Cada ventana busca el cierre real más cercano al límite pedido: los fines de semana y
 * feriados no tienen cierre propio, así que "7 días atrás" es "el último cierre en o
 * antes de esa fecha", no un índice fijo de posiciones.
 */
import type { EvolutionInstrument, EvolutionPoint } from "./evolution";
import { buildViewRows, selectTickers, summarizeRange } from "./evolution-view";
import type { ViewCurrency } from "@/components/dashboard/format";

export type PeriodKpiId = "today" | "7d" | "30d" | "ytd";

export type PeriodKpi = {
  id: PeriodKpiId;
  label: string;
  /** Cierre de inicio/fin de la ventana usada. `null` cuando `available` es `false`. */
  from: string | null;
  to: string | null;
  startValue: number;
  endValue: number;
  /** `end − start − aportes netos`: mismo criterio que `RangeSummary.result`. */
  change: number;
  /** TWR encadenado de la ventana. `null` sin base contra qué medir. */
  returnPercent: number | null;
  netContributions: number;
  /** `false` cuando no hay un punto anterior distinto con el que armar la ventana. */
  available: boolean;
  /**
   * El histórico no llega al inicio pedido de la ventana (p. ej. la cartera nació hace
   * menos de 7 días): se usó el primer cierre real disponible en su lugar.
   */
  partial: boolean;
};

const LABELS: Record<PeriodKpiId, string> = {
  today: "Hoy",
  "7d": "7 días",
  "30d": "30 días",
  ytd: "En el año",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function subtractDays(day: string, days: number): string {
  const time = new Date(`${day}T00:00:00.000Z`).getTime();
  return new Date(time - days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** `"2026-01-05"` → `"05/01"`. */
export function formatDDMM(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/**
 * "Hoy" solo cuando el último punto es un cierre real. Cuando vino del overlay en vivo
 * (`EvolutionPoint.isLive`) todavía no cerró la rueda — llamarle "Hoy" sugeriría un
 * resultado medido que no existe (ver el diagnóstico que motivó esto: un feed en vivo
 * que repite el cierre de ayer duplicaba el punto y "Hoy" daba cambio exactamente cero).
 */
function todayLabel(point: EvolutionPoint): string {
  return point.isLive ? LABELS.today : `Última rueda ${formatDDMM(point.date)}`;
}

/** Último índice cuyo `date` es <= `boundary`, o -1 si ninguno lo cumple. */
function lastIndexOnOrBefore(points: EvolutionPoint[], boundary: string): number {
  let result = -1;
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.date <= boundary) result = i;
    else break; // La serie es ascendente: una vez superado el límite, no vuelve.
  }
  return result;
}

function unavailable(id: PeriodKpiId): PeriodKpi {
  return {
    id,
    label: LABELS[id],
    from: null,
    to: null,
    startValue: 0,
    endValue: 0,
    change: 0,
    returnPercent: null,
    netContributions: 0,
    available: false,
    partial: false,
  };
}

function buildWindow(
  id: PeriodKpiId,
  daily: EvolutionPoint[],
  viewRows: ReturnType<typeof buildViewRows>,
  startIndex: number,
  endIndex: number,
  partial: boolean
): PeriodKpi {
  if (startIndex === endIndex) return unavailable(id);

  const summary = summarizeRange(viewRows.slice(startIndex, endIndex + 1));

  return {
    id,
    label: LABELS[id],
    from: daily[startIndex]!.date,
    to: daily[endIndex]!.date,
    startValue: summary.startValue,
    endValue: summary.endValue,
    change: summary.result,
    returnPercent: summary.returnPercent,
    netContributions: summary.netContributions,
    available: true,
    partial,
  };
}

export function buildPeriodKpis(
  daily: EvolutionPoint[],
  instruments: EvolutionInstrument[],
  currency: ViewCurrency,
  referenceDay?: string
): PeriodKpi[] {
  const ids: PeriodKpiId[] = ["today", "7d", "30d", "ytd"];

  if (daily.length === 0) return ids.map(unavailable);

  const targetEnd = referenceDay ?? daily.at(-1)!.date;
  const endIndex = lastIndexOnOrBefore(daily, targetEnd);
  if (endIndex === -1) return ids.map(unavailable);

  const endDate = daily[endIndex]!.date;
  const fullSelection = selectTickers(instruments, { types: "all", tickers: "all" });
  const viewRows = buildViewRows(daily, fullSelection, currency, true);

  const todayStart = endIndex > 0 ? endIndex - 1 : endIndex;
  const today = {
    ...buildWindow("today", daily, viewRows, todayStart, endIndex, false),
    label: todayLabel(daily[endIndex]!),
  };

  const windowKpi = (id: "7d" | "30d" | "ytd", boundary: string): PeriodKpi => {
    const startsBeforeBoundary = daily[0]!.date <= boundary;
    const startIndex = startsBeforeBoundary
      ? Math.min(lastIndexOnOrBefore(daily, boundary), endIndex)
      : 0;
    return buildWindow(id, daily, viewRows, startIndex, endIndex, !startsBeforeBoundary);
  };

  const sevenDay = windowKpi("7d", subtractDays(endDate, 7));
  const thirtyDay = windowKpi("30d", subtractDays(endDate, 30));
  const yearBoundary = `${Number(endDate.slice(0, 4)) - 1}-12-31`;
  const ytd = windowKpi("ytd", yearBoundary);

  return [today, sevenDay, thirtyDay, ytd];
}
