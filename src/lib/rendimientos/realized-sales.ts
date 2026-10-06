/**
 * Ventas realizadas: cuánto se ganó o perdió en cada venta contra el costo promedio.
 *
 * Es una métrica distinta de "Result. mes" (`attributeMonthlyPositionGains`): aquella mide
 * contra el cierre del mes anterior, esta contra lo que costó la posición. Mostrarlas en
 * la misma columna daría dos números que se contradicen para la misma venta.
 *
 * El costo sale del mismo replay que usa `buildHoldings` (`computePositionFromTrades`):
 * costo promedio ponderado (PPC), sin lotes FIFO, con las compras en dólares al CCL del
 * día en que se hicieron y los trades previos a un split ajustados por el evento. Reusarlo
 * evita que el realizado y la tabla de posiciones calculen el costo de dos maneras.
 *
 * **Módulo puro**: sin Prisma ni fechas del reloj. Ver `realized-sales.test.ts`.
 */

import Decimal from "decimal.js";
import { applyEventsToTrade } from "@/lib/events/apply";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import type { ViewCurrency } from "./types";
import {
  computePositionFromTrades,
  type TradeForHoldings,
} from "@/lib/transactions/holdings";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RealizedSale = {
  /** ISO de la operación, tal cual se guardó. */
  tradeDate: string;
  instrumentId: string;
  ticker: string;
  instrumentName: string;
  /** Cantidad y precio como se cargaron: no se ajustan por splits posteriores. */
  quantity: number;
  price: number;
  /** Lo cobrado, neto de comisiones (`netAmount`). */
  proceedsArs: number;
  /** Costo promedio por unidad de la posición en el momento de la venta. */
  avgCostArs: number;
  /** Costo de la cantidad vendida: `avgCostArs × quantity`. */
  costArs: number;
  realizedPnlArs: number;
  /** `null` si no hay costo contra el cual medir. */
  realizedReturnPct: number | null;
  /**
   * Variante en dólares: el costo al CCL del día de cada compra y lo cobrado al CCL del
   * día de la venta. `null` cuando falta el CCL de la venta o de alguna compra de la
   * posición — un costo en dólares a medias es peor que no mostrarlo.
   */
  proceedsUsd: number | null;
  costUsd: number | null;
  realizedPnlUsd: number | null;
  realizedReturnPctUsd: number | null;
  /**
   * Días desde que se abrió la posición vigente hasta la venta. Se cuenta desde la
   * compra que llevó la posición de cero a positiva (y se reinicia si se la cerró del
   * todo y se la volvió a abrir): con costo promedio no existen lotes individuales, así
   * que "cuánto hace que la tengo" es la antigüedad de la posición, no de una compra
   * puntual. `null` si la fecha no se puede interpretar.
   */
  holdingDays: number | null;
};

/**
 * Una entrada por cada SELL con posición previa, ordenadas por fecha ascendente.
 *
 * @param trades BUY/SELL de los instrumentos a medir. Se agrupan por instrumento.
 * @param events Eventos corporativos por instrumento, ascendentes por fecha efectiva.
 * @param cclAt CCL as-of una fecha; `null` si el histórico no llega.
 */
export function buildRealizedSales(
  trades: TradeForHoldings[],
  events: Map<string, CorporateEventForBuilder[]>,
  cclAt: (date: Date) => number | null
): RealizedSale[] {
  const byInstrument = new Map<string, TradeForHoldings[]>();
  for (const trade of trades) {
    const list = byInstrument.get(trade.instrumentId) ?? [];
    list.push(trade);
    byInstrument.set(trade.instrumentId, list);
  }

  const sales: RealizedSale[] = [];

  for (const [instrumentId, instrumentTrades] of byInstrument) {
    const sorted = [...instrumentTrades].sort(
      (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
    );
    const instrumentEvents = events.get(instrumentId) ?? [];
    const adjusted = instrumentEvents.length
      ? sorted.map((trade) => applyEventsToTrade(trade, instrumentEvents))
      : sorted;

    let runningQty = new Decimal(0);
    let openedAt: string | null = null;

    adjusted.forEach((trade, index) => {
      const quantity = new Decimal(trade.quantity);

      if (trade.type === "BUY") {
        if (runningQty.lte(0)) openedAt = trade.tradeDate;
        runningQty = runningQty.plus(quantity);
        return;
      }

      const before = computePositionFromTrades(adjusted.slice(0, index), {
        cclAt,
        currentCcl: null,
      });
      const original = sorted[index]!;

      if (before.quantity.gt(0)) {
        sales.push(
          toRealizedSale(original, trade, before, openedAt, cclAt)
        );
      }

      runningQty = Decimal.max(runningQty.minus(quantity), 0);
      if (runningQty.isZero()) openedAt = null;
    });
  }

  return sales.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

function toRealizedSale(
  original: TradeForHoldings,
  adjusted: TradeForHoldings,
  before: ReturnType<typeof computePositionFromTrades>,
  openedAt: string | null,
  cclAt: (date: Date) => number | null
): RealizedSale {
  const soldQty = new Decimal(adjusted.quantity);
  const originalQty = new Decimal(original.quantity);
  const proceeds = new Decimal(original.netAmount).abs();

  // Una venta mayor a la posición (dato inconsistente) libera como mucho todo el costo.
  const share = Decimal.min(soldQty.div(before.quantity), 1);
  const cost = before.costBasisArs.mul(share);
  const pnl = proceeds.minus(cost);

  const saleRate = cclAt(new Date(original.tradeDate));
  const proceedsUsd = saleRate && saleRate > 0 ? proceeds.div(saleRate) : null;
  const costUsd = before.costBasisUsd ? before.costBasisUsd.mul(share) : null;
  const pnlUsd = proceedsUsd && costUsd ? proceedsUsd.minus(costUsd) : null;

  return {
    tradeDate: original.tradeDate,
    instrumentId: original.instrumentId,
    ticker: original.ticker,
    instrumentName: original.instrumentName,
    quantity: originalQty.toNumber(),
    price: new Decimal(original.price).toNumber(),
    proceedsArs: proceeds.toNumber(),
    // Por unidad de lo que se vendió, en las unidades de la fecha de la venta.
    avgCostArs: originalQty.isZero() ? 0 : cost.div(originalQty).toNumber(),
    costArs: cost.toNumber(),
    realizedPnlArs: pnl.toNumber(),
    realizedReturnPct: cost.gt(0) ? pnl.div(cost).mul(100).toNumber() : null,
    proceedsUsd: pnlUsd ? proceedsUsd!.toNumber() : null,
    costUsd: pnlUsd ? costUsd!.toNumber() : null,
    realizedPnlUsd: pnlUsd ? pnlUsd.toNumber() : null,
    realizedReturnPctUsd: pnlUsd && costUsd!.gt(0) ? pnlUsd.div(costUsd!).mul(100).toNumber() : null,
    holdingDays: openedAt ? daysBetween(openedAt, original.tradeDate) : null,
  };
}

function daysBetween(from: string, to: string): number | null {
  const start = Date.parse(from.slice(0, 10));
  const end = Date.parse(to.slice(0, 10));
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / DAY_MS);
}

// ============================================================
// VISTA
// ============================================================

/**
 * Ventas dentro de los meses visibles (los que ya recortó el selector de período),
 * la más reciente primero. Se filtra por mes calendario UTC de la operación, igual que
 * el resto del motor agrupa los flujos.
 */
export function salesInMonths(
  sales: RealizedSale[],
  months: Array<{ month: string }>
): RealizedSale[] {
  const visible = new Set(months.map((row) => row.month));
  return sales
    .filter((s) => visible.has(s.tradeDate.slice(0, 7)))
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
}

export type RealizedFigures = {
  proceeds: number | null;
  /** Costo promedio por unidad vendida. */
  avgCost: number | null;
  cost: number | null;
  pnl: number | null;
  returnPct: number | null;
};

/**
 * Las cifras de una venta ya resueltas a la moneda activa. En dólares no se convierte
 * nada acá: el motor ya trae el costo al CCL de cada compra y lo cobrado al de la venta.
 */
export function realizedFigures(sale: RealizedSale, currency: ViewCurrency): RealizedFigures {
  if (currency === "ARS") {
    return {
      proceeds: sale.proceedsArs,
      avgCost: sale.avgCostArs,
      cost: sale.costArs,
      pnl: sale.realizedPnlArs,
      returnPct: sale.realizedReturnPct,
    };
  }

  return {
    proceeds: sale.proceedsUsd,
    avgCost: sale.costUsd !== null && sale.quantity > 0 ? sale.costUsd / sale.quantity : null,
    cost: sale.costUsd,
    pnl: sale.realizedPnlUsd,
    returnPct: sale.realizedReturnPctUsd,
  };
}

/**
 * Total realizado del período. Las ventas que no se pueden medir en la moneda activa no
 * suman cero: se cuentan aparte para que la UI avise que el total las deja afuera.
 */
export function totalRealizedPnl(
  sales: RealizedSale[],
  currency: ViewCurrency
): { total: number; unmeasured: number } {
  let total = 0;
  let unmeasured = 0;
  for (const sale of sales) {
    const pnl = realizedFigures(sale, currency).pnl;
    if (pnl === null) unmeasured += 1;
    else total += pnl;
  }
  return { total, unmeasured };
}
