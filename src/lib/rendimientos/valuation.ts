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
import type { MonthCoverage, MonthlyPositionDetail, PositionDetail } from "./types";
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
  /**
   * Costo en dólares: cada compra al CCL **de su propia fecha**.
   *
   * `null` si alguna compra quedó fuera del histórico de CCL. No es `costBasisArs`
   * dividido por `cclMid`: esa cuenta usa el mismo tipo de cambio arriba y abajo, se
   * cancela, y deja el rendimiento en dólares clavado al de pesos.
   */
  costBasisUsd: number | null;
  accumulatedIncomeArs: number;
  positions: PositionDetail[];
  coverage: MonthCoverage;
  staleTickers: string[];
  unrealizedReturnPct: number | null;
  /** El mismo no realizado medido en dólares. `null` sin CCL o sin costo medible. */
  unrealizedReturnPctUsd: number | null;
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

  const cclHit = ccl.asOf(valuationDate);
  const cclMid = cclHit?.value ?? null;

  // El costo en dólares se replaya con el CCL del día de cada compra y el valor con el
  // CCL de este cierre: esa asimetría es lo que hace que el rendimiento en dólares mida
  // el tipo de cambio en vez de cancelarlo.
  const holdings = buildHoldings(tradesToDate, priceMap, eventsByInstrument, {
    cclAt: (tradeDate) => ccl.asOf(tradeDate)?.value ?? null,
    currentCcl: cclMid,
  });

  let holdingsValueArs = new Decimal(0);
  let costBasisArs = new Decimal(0);
  let costBasisUsd: Decimal | null = new Decimal(0);
  for (const holding of holdings) {
    holdingsValueArs = holdingsValueArs.plus(new Decimal(holding.marketValueArs));
    costBasisArs = costBasisArs.plus(new Decimal(holding.costBasisArs));
    if (costBasisUsd === null) continue;
    // Una sola posición sin costo medible deja el total sin medir: sumar las que sí se
    // pueden daría un costo parcial que se lee como si fuera el de toda la cartera.
    costBasisUsd =
      holding.costBasisUsd === null ? null : costBasisUsd.plus(new Decimal(holding.costBasisUsd));
  }

  const holdingsValueUsd =
    cclMid && cclMid > 0 ? holdingsValueArs.div(cclMid) : null;

  // Valor invertido = posiciones a mercado + renta acumulada. Sin efectivo: el saldo
  // de la cuenta no forma parte del perímetro que se mide.
  const accumulatedIncomeArs = sumUpTo(incomeArsByDate, cutoff);
  const valueArs = holdingsValueArs.plus(accumulatedIncomeArs);
  const valueUsd = cclMid && cclMid > 0 ? valueArs.div(cclMid) : new Decimal(0);

  const positions: PositionDetail[] = holdings.map((holding) => {
    const valueArsNumber = Number(holding.marketValueArs);
    const holdingCost = Number(holding.costBasisArs);
    const holdingCostUsd = holding.costBasisUsd === null ? null : Number(holding.costBasisUsd);
    const valueUsdNumber = cclMid && cclMid > 0 ? valueArsNumber / cclMid : 0;
    return {
      instrumentId: holding.instrumentId,
      ticker: holding.ticker,
      instrumentName: holding.instrumentName,
      instrumentType: holding.instrumentType,
      quantity: Number(holding.quantity),
      priceArs: Number(holding.currentPriceArs),
      valueArs: valueArsNumber,
      valueUsd: valueUsdNumber,
      costBasisArs: holdingCost,
      unrealizedPnlArs: Number(holding.pnlArs),
      unrealizedReturnPct: unrealizedReturn(valueArsNumber, holdingCost),
      costBasisUsd: holdingCostUsd,
      unrealizedPnlUsd:
        holdingCostUsd === null || !cclMid ? null : valueUsdNumber - holdingCostUsd,
      unrealizedReturnPctUsd:
        holdingCostUsd === null || !cclMid
          ? null
          : unrealizedReturn(valueUsdNumber, holdingCostUsd),
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
    costBasisUsd: costBasisUsd === null ? null : costBasisUsd.toNumber(),
    accumulatedIncomeArs: accumulatedIncomeArs.toNumber(),
    positions,
    coverage,
    staleTickers: [...new Set(staleTickers)],
    unrealizedReturnPct: unrealizedReturn(
      holdingsValueArs.toNumber(),
      costBasisArs.toNumber()
    ),
    unrealizedReturnPctUsd:
      costBasisUsd === null || holdingsValueUsd === null
        ? null
        : unrealizedReturn(holdingsValueUsd.toNumber(), costBasisUsd.toNumber()),
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

/**
 * Atribuye a cada posición cuánto ganó/perdió puntualmente en el período: valor al
 * cierre menos valor al cierre anterior menos el capital neto invertido en ese
 * instrumento durante el período.
 *
 * Es la misma identidad que usa `gainArs` a nivel de cartera en `series.ts`
 * (`valor(fin) − valor(inicio) − capital neto`), aplicada ticker por ticker en vez de
 * al total. Por eso, y solo por eso, sumar `monthGainArs` de todas las filas de un mes
 * coincide con la `gainArs` de ese mes (salvo la renta cobrada, que no se atribuye por
 * ticker acá). `unrealizedPnlArs` — contra el costo de toda la vida — nunca coincide,
 * y confundir una cosa con la otra fue el origen de este helper.
 */
export function attributeMonthlyPositionGains(
  endPositions: PositionDetail[],
  startPositions: PositionDetail[],
  netInvestedByInstrumentArs: Map<string, number>,
  /**
   * El mismo capital en dólares, convertido al CCL del día de cada operación. Sin él la
   * atribución en dólares no se calcula: dividir `monthGainArs` por el CCL del cierre
   * sería la ganancia en pesos con otra etiqueta.
   */
  netInvestedByInstrumentUsd?: Map<string, number>
): MonthlyPositionDetail[] {
  const startByInstrument = new Map(startPositions.map((p) => [p.instrumentId, p]));

  return endPositions.map((position) => {
    const start = startByInstrument.get(position.instrumentId);
    const startValue = start?.valueArs ?? 0;
    const netInvested = netInvestedByInstrumentArs.get(position.instrumentId) ?? 0;
    const monthGainArs = position.valueArs - startValue - netInvested;

    // Base para el %: lo que ya había al empezar el mes: si la posición es nueva
    // (startValue = 0), se mide contra lo que se puso en el mes.
    const basis = startValue > 0 ? startValue : netInvested;
    const monthReturnPct = basis > 0 ? (monthGainArs / basis) * 100 : null;

    const startValueUsd = start?.valueUsd ?? 0;
    const netInvestedUsd = netInvestedByInstrumentUsd?.get(position.instrumentId) ?? 0;
    const monthGainUsd = netInvestedByInstrumentUsd
      ? position.valueUsd - startValueUsd - netInvestedUsd
      : null;
    const basisUsd = startValueUsd > 0 ? startValueUsd : netInvestedUsd;
    const monthReturnPctUsd =
      monthGainUsd !== null && basisUsd > 0 ? (monthGainUsd / basisUsd) * 100 : null;

    return { ...position, monthGainArs, monthReturnPct, monthGainUsd, monthReturnPctUsd };
  });
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
