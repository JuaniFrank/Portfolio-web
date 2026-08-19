/**
 * Núcleo de valuación del replay: la cartera al cierre de una fecha cualquiera.
 *
 * Vivía como closure dentro de `buildPerformanceReport`, así que no se podía testear
 * ni reutilizar. Acá es una función pura sobre insumos explícitos, en línea con la
 * regla del proyecto (ver `vitest.config.mts`): la lógica riesgosa vive en módulos
 * puros y el orquestador de Prisma solo cablea.
 *
 * El insight que lo habilita: `buildHoldings` es un replay puro y no conoce "hoy".
 * Filtrando trades a `tradeDate <= D` y pasándole precios as-of D, devuelve la cartera
 * al cierre de D.
 *
 * Consumidores: el motor mensual de `/rendimientos` (`series.ts`) y la serie de
 * evolución del dashboard (`@/lib/dashboard/evolution`).
 */

import Decimal from "decimal.js";
import { buildHoldings, type TradeForHoldings } from "@/lib/transactions/holdings";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import { isOnOrBeforeUtcDay, toUtcDay } from "./months";
import type { PriceIndex, TimeSeries } from "./price-series";
import { unrealizedReturn } from "./returns";
import type { MonthCoverage, PositionDetail } from "./types";
import type { MonetaryEvent } from "./cashflows";

/** Importe ya expresado en ARS, fechado al día UTC en que ocurrió. */
export type DatedAmount = { time: number; amount: Decimal };

/**
 * Insumos del replay. Todos son series históricas: el resultado se deriva de ellos,
 * así que corregir una operación vieja o mejorar la valuación se refleja en todo el
 * histórico sin recalcular nada guardado.
 */
export type ReplayInputs = {
  /** Solo BUY/SELL de instrumentos elegibles, ordenados por fecha. */
  trades: TradeForHoldings[];
  prices: PriceIndex;
  ccl: TimeSeries;
  eventsByInstrument: Map<string, CorporateEventForBuilder[]>;
  /** Renta en ARS por fecha, ascendente. Ver `accumulateInArs`. */
  incomeArsByDate: DatedAmount[];
};

export type PortfolioValuation = {
  valuationDate: Date;
  /** CCL usado, as-of la fecha de valuación. `null` si no había cotización. */
  cclMid: number | null;
  /** Posiciones a mercado + renta acumulada. Sin efectivo. */
  valueArs: number;
  valueUsd: number;
  /** Solo posiciones a mercado, sin renta. */
  holdingsValueArs: number;
  costBasisArs: number;
  accumulatedIncomeArs: number;
  positions: PositionDetail[];
  coverage: MonthCoverage;
  staleTickers: string[];
  unrealizedReturnPct: number | null;
};

/**
 * Valúa la cartera al cierre de `valuationDate`.
 *
 * `windowStart` define desde cuándo un precio se considera "del período": si el último
 * precio disponible es anterior, viene por arrastre (forward-fill) y se marca. Un
 * número arrastrado no es un número medido, y la UI necesita poder distinguirlos.
 */
export function valuatePortfolioAt(
  inputs: ReplayInputs,
  valuationDate: Date,
  windowStart: Date
): PortfolioValuation {
  const { trades, prices, ccl, eventsByInstrument, incomeArsByDate } = inputs;
  const cutoff = valuationDate.getTime();

  // Comparación por DÍA, no por instante: `tradeDate` se guarda con hora (mediodía
  // UTC en los imports) y los cierres son medianoche UTC, así que comparar instantes
  // dejaba las compras del último día fuera de la valuación mientras su capital sí
  // contaba como flujo — una pérdida inventada del tamaño exacto de esas compras.
  const tradesToDate = trades.filter((trade) =>
    isOnOrBeforeUtcDay(new Date(trade.tradeDate), valuationDate)
  );

  const priceMap = new Map<string, string>();
  const staleTickers: string[] = [];
  let anyPriced = false;

  for (const trade of tradesToDate) {
    if (priceMap.has(trade.instrumentId)) continue;
    const hit = prices.asOf(trade.instrumentId, valuationDate);
    if (!hit) {
      // Sin precio: `buildHoldings` cae al PPP, o sea que la posición queda valuada
      // a costo. Es una valuación, pero no una medición.
      staleTickers.push(trade.ticker);
      continue;
    }
    priceMap.set(trade.instrumentId, String(hit.value));
    anyPriced = true;
    // Arrastre: el precio no es del período, es el último conocido de antes.
    if (hit.date.getTime() < windowStart.getTime()) staleTickers.push(trade.ticker);
  }

  const holdings = buildHoldings(tradesToDate, priceMap, eventsByInstrument);
  const cclHit = ccl.asOf(valuationDate);
  const cclMid = cclHit?.value ?? null;

  let holdingsValueArs = new Decimal(0);
  let costBasisArs = new Decimal(0);
  for (const holding of holdings) {
    holdingsValueArs = holdingsValueArs.plus(new Decimal(holding.marketValueArs));
    costBasisArs = costBasisArs.plus(new Decimal(holding.costBasisArs));
  }

  // Valor invertido = posiciones a mercado + renta acumulada. Sin efectivo: el saldo
  // de la cuenta no forma parte del perímetro que se mide.
  const accumulatedIncomeArs = sumUpTo(incomeArsByDate, cutoff);
  const valueArs = holdingsValueArs.plus(accumulatedIncomeArs);
  const valueUsd = cclMid && cclMid > 0 ? valueArs.div(cclMid) : new Decimal(0);

  const positions: PositionDetail[] = holdings.map((holding) => {
    const valueArsNumber = Number(holding.marketValueArs);
    const holdingCost = Number(holding.costBasisArs);
    return {
      instrumentId: holding.instrumentId,
      ticker: holding.ticker,
      instrumentName: holding.instrumentName,
      instrumentType: holding.instrumentType,
      quantity: Number(holding.quantity),
      priceArs: Number(holding.currentPriceArs),
      valueArs: valueArsNumber,
      valueUsd: cclMid && cclMid > 0 ? valueArsNumber / cclMid : 0,
      costBasisArs: holdingCost,
      unrealizedPnlArs: Number(holding.pnlArs),
      unrealizedReturnPct: unrealizedReturn(valueArsNumber, holdingCost),
      priceIsStale: staleTickers.includes(holding.ticker),
    };
  });

  const coverage: MonthCoverage =
    holdings.length === 0
      ? "empty"
      : staleTickers.length > 0 || !anyPriced
        ? "partial"
        : "full";

  return {
    valuationDate,
    cclMid,
    valueArs: valueArs.toNumber(),
    valueUsd: valueUsd.toNumber(),
    holdingsValueArs: holdingsValueArs.toNumber(),
    costBasisArs: costBasisArs.toNumber(),
    accumulatedIncomeArs: accumulatedIncomeArs.toNumber(),
    positions,
    coverage,
    staleTickers: [...new Set(staleTickers)],
    unrealizedReturnPct: unrealizedReturn(
      holdingsValueArs.toNumber(),
      costBasisArs.toNumber()
    ),
  };
}

/**
 * Expresa cada evento de renta en ARS al CCL **de su propia fecha** y los ordena.
 *
 * Se convierte al momento del cobro y no al cierre del período porque es un importe
 * histórico: se recibió esa cantidad de pesos ese día. Un evento en dólares sin CCL
 * disponible se descarta en lugar de convertirse a un valor inventado.
 */
export function accumulateInArs(events: MonetaryEvent[], ccl: TimeSeries): DatedAmount[] {
  const amounts: DatedAmount[] = [];

  for (const event of events) {
    // Normalizado a día UTC por el mismo motivo que los trades: un dividendo cobrado
    // el último día del mes se compara contra un cierre a medianoche UTC.
    const time = toUtcDay(event.date).getTime();

    if (event.currency === "ARS") {
      amounts.push({ time, amount: new Decimal(event.amount) });
      continue;
    }
    const rate = ccl.asOf(event.date)?.value ?? null;
    if (!rate || rate <= 0) continue;
    amounts.push({ time, amount: new Decimal(event.amount * rate) });
  }

  return amounts.sort((a, b) => a.time - b.time);
}

/** Suma acumulada hasta `cutoff` inclusive. Asume `amounts` ordenado ascendente. */
export function sumUpTo(amounts: DatedAmount[], cutoff: number): Decimal {
  let total = new Decimal(0);
  for (const entry of amounts) {
    if (entry.time > cutoff) break;
    total = total.plus(entry.amount);
  }
  return total;
}
