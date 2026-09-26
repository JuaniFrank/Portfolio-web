/**
 * Vista filtrable de la evolución del portfolio: selección de tickers, modo (valor /
 * resultado / rendimiento) y resumen del rango visible.
 *
 * **Módulo puro**: no sabe de charts ni de React. Toma la serie completa de
 * `EvolutionPoint` (con su detalle por posición, ver `evolution.ts`) y produce las filas
 * que consume la UI. El recorte por rango (`sliceByRange`, en `time-range.ts`) sigue
 * pasando *después*: acá se computan `invested`/`cumulativeReturn` sobre la serie
 * completa para que un aporte anterior al recorte no desaparezca del acumulado.
 *
 * Reutiliza `subPeriodReturn`/`chainReturns`/`drawdownFromCumulative` de
 * `@/lib/rendimientos/returns`: es la misma matemática de TWR que ya usa `evolution.ts`
 * para el agregado, aplicada ahora a la selección.
 */

import { chainReturns, drawdownFromCumulative, subPeriodReturn } from "@/lib/rendimientos/returns";
import type { ViewCurrency } from "@/components/dashboard/format";
import type { EvolutionInstrument, EvolutionPoint, EvolutionTrade } from "./evolution";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// Selección de tickers
// ---------------------------------------------------------------------------

export type InstrumentTypeSet = Set<EvolutionInstrument["type"]> | "all";
export type TickerSet = Set<string> | "all";

export type TickerSelectionFilter = {
  types: InstrumentTypeSet;
  tickers: TickerSet;
};

/** Tickers efectivos de un filtro: intersección de tipo elegido y ticker elegido. */
export function selectTickers(
  instruments: EvolutionInstrument[],
  filter: TickerSelectionFilter
): Set<string> {
  const result = new Set<string>();
  for (const instrument of instruments) {
    if (filter.types !== "all" && !filter.types.has(instrument.type)) continue;
    if (filter.tickers !== "all" && !filter.tickers.has(instrument.ticker)) continue;
    result.add(instrument.ticker);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Filas de la vista
// ---------------------------------------------------------------------------

export type ViewRow = {
  date: string;
  /** Suma de `valueArs`/`valueUsd` de las posiciones seleccionadas, según moneda. */
  value: number;
  /** Aportes netos acumulados de la selección, desde el primer punto de la serie
   * completa (no se resetea al recortar por rango). */
  invested: number;
  /** `value - invested`: resultado acumulado, sin rebasar. */
  result: number;
  /** Rendimiento del tramo (TWR), en puntos porcentuales. `null` sin base medible o en
   * el primer punto de la serie (no hay tramo anterior que medir). */
  periodReturn: number | null;
  /** Rendimiento acumulado desde el primer punto de la serie completa (`chainReturns`
   * de `periodReturn`). Se re-encadena con `rebaseForRange` para un rango visible. */
  cumulativeReturn: number | null;
  /** Alguna posición seleccionada de este punto usó precio estimado (ver
   * `EvolutionPositionBreakdown.priceEstimated`). */
  hasEstimatedPrices: boolean;
};

/**
 * Filas de la selección para toda la serie (sin recortar por rango).
 *
 * `periodReturn` reutiliza `subPeriodReturn` con el flujo de la ventana de cada punto:
 * mismo criterio que el agregado en `evolution.ts` (ganancia neta de aportes/retiros,
 * base = valor previo si había cartera, o el flujo si el tramo arranca desde cero). El
 * primer punto de la serie nunca tiene tramo anterior, así que su `periodReturn` es
 * `null` sin llamar a `subPeriodReturn` — igual que hace `buildSeries` en `evolution.ts`.
 *
 * `value` suma `valueArs/Usd` **más** `incomeArs/Usd` de cada posición seleccionada: la
 * renta (dividendos, cupones, amortizaciones) es parte del valor invertido, no un flujo
 * — igual que hace `valuatePortfolioAt` con el agregado. Cuando `isFullSelection` es
 * `true` (la selección cubre todos los `instruments` de la serie) se suma además
 * `point.unattributedIncomeArs/Usd`, para que "Todo" reproduzca el agregado exacto; con
 * una selección parcial esa renta sin atribuir no es de nadie en particular y queda
 * afuera.
 */
export function buildViewRows(
  points: EvolutionPoint[],
  selection: Set<string>,
  currency: ViewCurrency,
  isFullSelection: boolean
): ViewRow[] {
  const valueKey = currency === "ARS" ? ("valueArs" as const) : ("valueUsd" as const);
  const flowKey = currency === "ARS" ? ("netFlowArs" as const) : ("netFlowUsd" as const);
  const incomeKey = currency === "ARS" ? ("incomeArs" as const) : ("incomeUsd" as const);
  const unattributedKey =
    currency === "ARS" ? ("unattributedIncomeArs" as const) : ("unattributedIncomeUsd" as const);

  let cumulativeInvested = 0;
  let previousValue = 0;
  const periodReturns: Array<number | null> = [];
  const partial: Array<Omit<ViewRow, "cumulativeReturn">> = [];

  points.forEach((point, index) => {
    const selected = point.positions.filter((position) => selection.has(position.ticker));
    const unattributedIncome = isFullSelection ? point[unattributedKey] : 0;
    const value = round2(
      selected.reduce((sum, position) => sum + position[valueKey] + position[incomeKey], 0) +
        unattributedIncome
    );
    const windowFlow = round2(selected.reduce((sum, position) => sum + position[flowKey], 0));
    const hasEstimatedPrices = selected.some((position) => position.priceEstimated);

    cumulativeInvested = round2(cumulativeInvested + windowFlow);

    const periodReturn = index === 0 ? null : subPeriodReturn(previousValue, value, windowFlow);

    periodReturns.push(periodReturn);
    partial.push({
      date: point.date,
      value,
      invested: cumulativeInvested,
      result: round2(value - cumulativeInvested),
      periodReturn: periodReturn === null ? null : round4(periodReturn),
      hasEstimatedPrices,
    });

    previousValue = value;
  });

  const cumulativeReturns = chainReturns(periodReturns);

  return partial.map((row, index) => ({
    ...row,
    cumulativeReturn: cumulativeReturns[index] ?? null,
  }));
}

/**
 * Encadena `periodReturn` desde 0 en el primer punto **visible**, para un rango
 * recortado con `sliceByRange`.
 *
 * A diferencia de `chainReturns` (que deja `null` hasta el primer tramo medible), acá
 * el primer punto del rango es el punto de partida por definición: su
 * `cumulativeReturn` es siempre 0, y el resto encadena los `periodReturn` reales de los
 * puntos siguientes (que ya miden contra su verdadero punto anterior, visible o no).
 *
 * `value`/`invested`/`result` no se tocan: en modo Resultado el número es el resultado
 * absoluto acumulado (`value - invested`), no relativo al inicio del rango — es más
 * honesto que "resetear" un resultado en pesos, que no tiene el mismo significado que
 * resetear un porcentaje.
 */
export function rebaseForRange(rows: ViewRow[]): ViewRow[] {
  if (rows.length === 0) return rows;

  let factor = 1;
  const rebased: number[] = [0];
  for (let i = 1; i < rows.length; i++) {
    const periodReturn = rows[i]!.periodReturn;
    if (periodReturn !== null && Number.isFinite(periodReturn)) {
      factor *= 1 + periodReturn / 100;
    }
    rebased.push(round4((factor - 1) * 100));
  }

  return rows.map((row, index) => ({ ...row, cumulativeReturn: rebased[index]! }));
}

// ---------------------------------------------------------------------------
// Resumen del rango visible
// ---------------------------------------------------------------------------

export type RangeSummary = {
  startValue: number;
  endValue: number;
  /** Aportes netos del rango, después del primer punto visible (ver `rebaseForRange`:
   * el flujo del primer punto ya pasó "antes" del rango que se está resumiendo). */
  netContributions: number;
  result: number;
  /** TWR encadenado del rango, rebasado a 0 en el primer punto visible. */
  returnPercent: number | null;
  /** Máxima caída del índice de rendimiento acumulado del rango (≤ 0). Mide performance,
   * no valor: un retiro no aparece como caída (ver `drawdownFromCumulative`). */
  maxDrawdown: number;
  estimatedPrices: boolean;
};

const EMPTY_SUMMARY: RangeSummary = {
  startValue: 0,
  endValue: 0,
  netContributions: 0,
  result: 0,
  returnPercent: null,
  maxDrawdown: 0,
  estimatedPrices: false,
};

export function summarizeRange(rows: ViewRow[]): RangeSummary {
  if (rows.length === 0) return EMPTY_SUMMARY;

  const rebased = rebaseForRange(rows);
  const startValue = rows[0]!.value;
  const endValue = rows.at(-1)!.value;
  const netContributions = round2(rows.at(-1)!.invested - rows[0]!.invested);
  const result = round2(endValue - startValue - netContributions);
  const cumulativeSeries = rebased.map((row) => row.cumulativeReturn);
  const returnPercent = cumulativeSeries.at(-1) ?? null;
  const drawdowns = drawdownFromCumulative(cumulativeSeries);
  const maxDrawdown = drawdowns.length > 0 ? Math.min(...drawdowns) : 0;
  const estimatedPrices = rows.some((row) => row.hasEstimatedPrices);

  return { startValue, endValue, netContributions, result, returnPercent, maxDrawdown, estimatedPrices };
}

// ---------------------------------------------------------------------------
// Marcas de operaciones
// ---------------------------------------------------------------------------

export type TradeMarkerSide = "buy" | "sell" | "mixed";

export type TradeMarkerItem = {
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  amount: number;
};

export type EvolutionTradeMarker = {
  /** Fecha del bucket visible al que se snapeó (`YYYY-MM-DD`), no la fecha real de la
   * operación — ver el criterio de snapping abajo. */
  date: string;
  side: TradeMarkerSide;
  count: number;
  totalAmount: number;
  trades: TradeMarkerItem[];
};

/**
 * Agrupa operaciones de la selección en marcas por fecha visible.
 *
 * Cada operación se snapea a la primera fecha de `visibleDates` que sea `>=` su propia
 * fecha (para semanal/mensual esa fecha ya es el cierre del bucket, ver
 * `bucketByLastDay`). Una operación anterior a la primera fecha visible pertenece a un
 * bucket que quedó fuera de la ventana — atribuírsela al primer punto mostrado sería
 * marcar una operación vieja como si hubiera pasado ahí, así que se descarta, igual que
 * una operación posterior a la última fecha visible (sin bucket al que snapear todavía).
 */
export function tradesForSelection(
  trades: EvolutionTrade[],
  tickers: TickerSet,
  visibleDates: string[],
  currency: ViewCurrency
): EvolutionTradeMarker[] {
  if (visibleDates.length === 0) return [];

  const sortedDates = [...visibleDates].sort();
  const first = sortedDates[0]!;
  const last = sortedDates.at(-1)!;
  const amountKey = currency === "ARS" ? ("amountArs" as const) : ("amountUsd" as const);

  const byDate = new Map<string, EvolutionTradeMarker>();

  for (const trade of trades) {
    if (tickers !== "all" && !tickers.has(trade.ticker)) continue;
    if (trade.date < first || trade.date > last) continue;

    const bucketDate = sortedDates.find((date) => date >= trade.date);
    if (!bucketDate) continue;

    const amount = round2(trade[amountKey]);
    const existing = byDate.get(bucketDate);

    if (!existing) {
      byDate.set(bucketDate, {
        date: bucketDate,
        side: trade.side,
        count: 1,
        totalAmount: amount,
        trades: [{ ticker: trade.ticker, side: trade.side, quantity: trade.quantity, amount }],
      });
      continue;
    }

    existing.count += 1;
    existing.totalAmount = round2(existing.totalAmount + amount);
    existing.trades.push({
      ticker: trade.ticker,
      side: trade.side,
      quantity: trade.quantity,
      amount,
    });
    if (existing.side !== trade.side) existing.side = "mixed";
  }

  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
