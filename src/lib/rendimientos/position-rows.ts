/**
 * Filas de la tabla interactiva de posiciones de `/rendimientos`. **Módulo puro**:
 * no toca Prisma ni recalcula la valuación — toma las `PositionDetail` que ya salieron
 * de `valuatePortfolioAt` y les agrega lo que esa valuación no expone por posición:
 * costo promedio por unidad, variación diaria, peso de cartera y antigüedad de la
 * tenencia actual.
 */

import Decimal from "decimal.js";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import { toUtcDay } from "./months";
import type { PriceIndex } from "./price-series";
import type { InstrumentType } from "@/lib/generated/prisma";
import type { PositionDetail } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Umbral por debajo del cual una cantidad se considera "cerrada": evita que el
 * residuo de punto flotante de una venta total deje la posición "abierta en 1e-9". */
const QUANTITY_EPSILON = new Decimal("0.0000001");

export type PositionTableRow = {
  instrumentId: string;
  ticker: string;
  instrumentName: string;
  instrumentType: InstrumentType;
  quantity: number;
  /** Costo promedio por unidad. `null` sin cantidad (posición vacía, defensivo). */
  avgCostArs: number | null;
  /** `null` cuando el costo en dólares no es medible (compra fuera del histórico de CCL). */
  avgCostUsd: number | null;
  priceArs: number;
  /** Precio de hoy contra el cierre anterior de la serie. `null` sin cierre previo. */
  dailyChangePct: number | null;
  valueArs: number;
  valueUsd: number;
  /** Valor de la posición sobre el valor total de la cartera. Es la misma proporción
   * en ARS y en USD (ambos se dividen por el mismo CCL), así que no depende del toggle. */
  weightPct: number;
  returnArs: { amount: number; pct: number | null };
  returnUsd: { amount: number | null; pct: number | null };
  /** Días desde la primera compra de la posición abierta actual. `null` si no se pudo
   * determinar (defensivo: no debería pasar con el historial completo de operaciones). */
  holdingDays: number | null;
  priceIsStale: boolean;
  priceIsLive: boolean;
};

/**
 * Arma una fila por posición abierta. `trades` necesita el historial completo (no solo
 * el del período visible): la antigüedad de una tenencia puede empezar años antes de la
 * ventana que se está mirando.
 */
export function buildPositionRows(
  positions: PositionDetail[],
  trades: TradeForHoldings[],
  prices: PriceIndex,
  today: Date
): PositionTableRow[] {
  const totalValueArs = positions.reduce((sum, position) => sum + position.valueArs, 0);
  const holdingStarts = holdingStartDates(trades);

  return positions.map((position) => ({
    instrumentId: position.instrumentId,
    ticker: position.ticker,
    instrumentName: position.instrumentName,
    instrumentType: position.instrumentType,
    quantity: position.quantity,
    avgCostArs: position.quantity > 0 ? position.costBasisArs / position.quantity : null,
    avgCostUsd:
      position.costBasisUsd === null || position.quantity <= 0
        ? null
        : position.costBasisUsd / position.quantity,
    priceArs: position.priceArs,
    dailyChangePct: dailyChangePct(position, prices, today),
    valueArs: position.valueArs,
    valueUsd: position.valueUsd,
    weightPct: totalValueArs > 0 ? (position.valueArs / totalValueArs) * 100 : 0,
    returnArs: { amount: position.unrealizedPnlArs, pct: position.unrealizedReturnPct },
    returnUsd: { amount: position.unrealizedPnlUsd, pct: position.unrealizedReturnPctUsd },
    holdingDays: holdingDaysFor(position.instrumentId, holdingStarts, today),
    priceIsStale: position.priceIsStale,
    priceIsLive: position.priceIsLive,
  }));
}

function dailyChangePct(
  position: PositionDetail,
  prices: PriceIndex,
  today: Date
): number | null {
  const hit = prices.asOf(position.instrumentId, today);
  if (!hit) return null;

  const previous = prices.previousClose(position.instrumentId, hit.date);
  if (!previous || previous.value === 0) return null;

  return ((hit.value - previous.value) / previous.value) * 100;
}

/**
 * Fecha de inicio de la tenencia abierta actualmente, por instrumento. Replaya BUY/SELL
 * en orden y reinicia el conteo cada vez que la cantidad vuelve a cero: la antigüedad de
 * una posición es la de su lote actual, no la de la primera compra de la que quede
 * historia si hubo una venta total en el medio.
 */
function holdingStartDates(trades: TradeForHoldings[]): Map<string, Date> {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
  );

  const quantities = new Map<string, Decimal>();
  const starts = new Map<string, Date>();

  for (const trade of sorted) {
    const current = quantities.get(trade.instrumentId) ?? new Decimal(0);
    const delta = new Decimal(trade.quantity).mul(trade.type === "BUY" ? 1 : -1);
    const next = current.plus(delta);

    if (current.lte(QUANTITY_EPSILON) && next.gt(QUANTITY_EPSILON)) {
      starts.set(trade.instrumentId, toUtcDay(new Date(trade.tradeDate)));
    } else if (next.lte(QUANTITY_EPSILON)) {
      starts.delete(trade.instrumentId);
    }

    quantities.set(trade.instrumentId, next);
  }

  return starts;
}

function holdingDaysFor(
  instrumentId: string,
  starts: Map<string, Date>,
  today: Date
): number | null {
  const start = starts.get(instrumentId);
  if (!start) return null;

  const diff = toUtcDay(today).getTime() - start.getTime();
  return Math.max(0, Math.round(diff / MS_PER_DAY));
}

/**
 * "2a 1m", "5m", "12d": la unidad más gruesa que tenga sentido, sin arrastrar
 * fracciones de días en años y meses redondeados a 30 días parejos.
 */
export function formatHoldingAge(days: number): string {
  if (days >= 365) {
    const years = Math.floor(days / 365);
    const remainingDays = days - years * 365;
    const months = Math.floor(remainingDays / 30);
    return months > 0 ? `${years}a ${months}m` : `${years}a`;
  }

  if (days >= 30) {
    return `${Math.floor(days / 30)}m`;
  }

  return `${days}d`;
}
