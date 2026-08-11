/**
 * Motor de rendimientos: reconstruye la serie mensual replayando transacciones
 * contra series de precios históricas.
 *
 * Es el reemplazo de la dependencia de `PortfolioSnapshot`. La diferencia de fondo:
 * los snapshots guardaban el *resultado* de una valuación, así que nunca se podían
 * recalcular ni completar hacia atrás. Acá se guardan los *insumos* (precios, CCL,
 * transacciones) y el resultado se deriva cada vez. Eso hace que corregir una
 * operación vieja, importar un lote atrasado o mejorar la lógica de valuación se
 * refleje en todo el histórico automáticamente.
 *
 * El insight que lo habilita: `buildHoldings` es una función pura de replay y no
 * conoce "hoy". Filtrando trades a `tradeDate <= D` y pasándole precios as-of D,
 * devuelve la cartera al cierre de D.
 *
 * El perímetro medido es **el capital invertido en activos**, no el saldo del broker:
 * las compras son el aporte y las ventas el retiro, así que el cálculo no depende de que
 * el usuario cargue depósitos. Ver `cashflows.ts` para el razonamiento completo.
 */

import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import type { InstrumentType } from "@/lib/generated/prisma";
import { EOD_PRICE_SOURCE } from "@/lib/market/history-sync";
import { buildHoldings, type TradeForHoldings } from "@/lib/transactions/holdings";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import { buildIndexBenchmark, buildInflationBenchmark } from "./benchmarks";
import {
  classifyCapitalFlows,
  classifyIncome,
  type MonetaryEvent,
  type TransactionForFlows,
} from "./cashflows";
import {
  enumerateMonths,
  isOnOrBeforeUtcDay,
  monthEnd,
  monthStart,
  toUtcDay,
  type MonthKey,
} from "./months";
import { PriceIndex, TimeSeries } from "./price-series";
import {
  annualizeReturn,
  chainReturns,
  combineSubPeriods,
  drawdownFromCumulative,
  findExtremeMonths,
  subPeriodReturn,
  unrealizedReturn,
} from "./returns";
import {
  EXCLUSION_REASONS,
  PERFORMANCE_INSTRUMENT_TYPES,
  type ExcludedHolding,
  type MonthCoverage,
  type MonthlyPerformanceRow,
  type PerformanceReport,
  type PerformanceSummary,
  type PositionDetail,
} from "./types";

const ELIGIBLE_TYPES = new Set<InstrumentType>(PERFORMANCE_INSTRUMENT_TYPES);

export type BuildSeriesOptions = {
  /**
   * Portfolios a incluir. El motor agrega varios sin cambios: cuando exista la
   * feature de multi-portfolio basta pasarle más ids.
   */
  portfolioIds: string[];
  portfolioName: string;
  /** Primer mes a reportar. Por defecto, el mes de la primera transacción. */
  from?: Date;
  /** Último mes a reportar. Por defecto, el mes actual. */
  to?: Date;
};

export async function buildPerformanceReport(
  opts: BuildSeriesOptions
): Promise<PerformanceReport> {
  const { portfolioIds, portfolioName } = opts;

  if (portfolioIds.length === 0) return emptyReport(portfolioName);

  const transactions = await prisma.transaction.findMany({
    where: { portfolioId: { in: portfolioIds } },
    orderBy: { tradeDate: "asc" },
    select: {
      type: true,
      tradeDate: true,
      quantity: true,
      price: true,
      netAmount: true,
      currencyCode: true,
      instrument: {
        select: { id: true, ticker: true, name: true, type: true },
      },
    },
  });

  const firstTransaction = transactions[0];
  if (!firstTransaction) return emptyReport(portfolioName);

  const rangeStart = opts.from ?? firstTransaction.tradeDate;
  const rangeEnd = opts.to ?? new Date();
  const months = enumerateMonths(rangeStart, rangeEnd);
  if (months.length === 0) return emptyReport(portfolioName);

  // Los precios/CCL se necesitan desde el primer mes reportado, pero el replay de
  // trades y de caja arranca siempre desde la primera transacción: una compra de
  // 2024 sigue formando parte de la cartera de 2026.
  const seriesFloor = monthStart(months[0]!);

  const eligibleInstrumentIds = [
    ...new Set(
      transactions
        .filter((tx) => tx.instrument && ELIGIBLE_TYPES.has(tx.instrument.type))
        .map((tx) => tx.instrument!.id)
    ),
  ];

  const [priceRows, cclRows, inflationRows, mervalRows, sp500Rows, eventRows] =
    await Promise.all([
      eligibleInstrumentIds.length > 0
        ? prisma.priceCache.findMany({
            where: {
              instrumentId: { in: eligibleInstrumentIds },
              source: EOD_PRICE_SOURCE,
            },
            orderBy: { datetime: "asc" },
            select: { instrumentId: true, datetime: true, close: true },
          })
        : Promise.resolve([]),
      prisma.fxRate.findMany({
        where: { baseCurrencyCode: "USD", quoteCurrencyCode: "ARS", source: "CCL" },
        orderBy: { date: "asc" },
        select: { date: true, mid: true },
      }),
      prisma.macroSeries.findMany({
        where: { code: "IPC_AR" },
        orderBy: { date: "asc" },
        select: { date: true, value: true },
      }),
      prisma.macroSeries.findMany({
        where: { code: "MERVAL" },
        orderBy: { date: "asc" },
        select: { date: true, value: true },
      }),
      prisma.macroSeries.findMany({
        where: { code: "SP500" },
        orderBy: { date: "asc" },
        select: { date: true, value: true },
      }),
      prisma.corporateEvent.findMany({
        where: { instrumentId: { in: eligibleInstrumentIds } },
        orderBy: { effectiveDate: "asc" },
        select: {
          instrumentId: true,
          eventType: true,
          effectiveDate: true,
          numerator: true,
          denominator: true,
        },
      }),
    ]);

  const prices = new PriceIndex(
    priceRows.map((row) => ({
      instrumentId: row.instrumentId,
      date: row.datetime,
      close: Number(row.close),
    }))
  );

  const ccl = new TimeSeries(
    cclRows.map((row) => ({ date: row.date, value: Number(row.mid) }))
  );

  const eventsByInstrument = new Map<string, CorporateEventForBuilder[]>();
  for (const event of eventRows) {
    const list = eventsByInstrument.get(event.instrumentId) ?? [];
    list.push({
      instrumentId: event.instrumentId,
      eventType: event.eventType,
      effectiveDate: event.effectiveDate.toISOString().slice(0, 10),
      numerator: event.numerator.toString(),
      denominator: event.denominator.toString(),
    });
    eventsByInstrument.set(event.instrumentId, list);
  }

  const trades: TradeForHoldings[] = [];
  for (const tx of transactions) {
    if (!tx.instrument) continue;
    if (tx.type !== "BUY" && tx.type !== "SELL") continue;
    if (!ELIGIBLE_TYPES.has(tx.instrument.type)) continue;
    trades.push({
      instrumentId: tx.instrument.id,
      ticker: tx.instrument.ticker,
      instrumentType: tx.instrument.type,
      instrumentName: tx.instrument.name,
      type: tx.type,
      quantity: tx.quantity.toString(),
      price: tx.price.toString(),
      netAmount: tx.netAmount.toString(),
      tradeDate: tx.tradeDate.toISOString(),
    });
  }

  const forFlows: TransactionForFlows[] = transactions.map((tx) => ({
    type: tx.type,
    tradeDate: tx.tradeDate,
    netAmount: Number(tx.netAmount),
    currencyCode: tx.currencyCode,
    instrumentEligible: tx.instrument ? ELIGIBLE_TYPES.has(tx.instrument.type) : false,
  }));

  const capitalFlows = classifyCapitalFlows(forFlows);
  const incomeEvents = classifyIncome(forFlows);

  // ---- Valuación ----------------------------------------------------------

  type Valuation = {
    month: MonthKey;
    valuationDate: Date;
    cclMonthEnd: number | null;
    valueArs: number;
    valueUsd: number;
    positions: PositionDetail[];
    coverage: MonthCoverage;
    staleTickers: string[];
    unrealizedReturnPct: number | null;
  };

  // Renta acumulada hasta cada cierre. Vive dentro del perímetro en vez de tratarse
  // como salida de capital: un dividendo es retorno generado, no plata que se fue.
  const incomeArsByDate = accumulateInArs(incomeEvents, ccl);

  /**
   * Valúa la cartera al cierre de una fecha cualquiera.
   *
   * `windowStart` define desde cuándo un precio se considera "del período": si el
   * último precio disponible es anterior, viene por arrastre y se marca.
   */
  const valuateAt = (valuationDate: Date, month: MonthKey, windowStart: Date): Valuation => {
    const cutoff = valuationDate.getTime();

    // Comparación por DÍA, no por instante: `tradeDate` se guarda con hora (mediodía
    // UTC en los imports) y el cierre de mes es medianoche UTC, así que comparar
    // instantes dejaba las compras del último día del mes fuera de la valuación
    // mientras su capital sí contaba como flujo — una pérdida inventada del tamaño
    // exacto de esas compras.
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
        // Sin precio: `buildHoldings` cae al PPP, o sea que la posición queda
        // valuada a costo. Es una valuación, pero no una medición.
        staleTickers.push(trade.ticker);
        continue;
      }
      priceMap.set(trade.instrumentId, String(hit.value));
      anyPriced = true;
      // Arrastre: el precio no es de este mes, es el último conocido de antes.
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
      month,
      valuationDate,
      cclMonthEnd: cclMid,
      valueArs: valueArs.toNumber(),
      valueUsd: valueUsd.toNumber(),
      positions,
      coverage,
      staleTickers: [...new Set(staleTickers)],
      unrealizedReturnPct: unrealizedReturn(
        holdingsValueArs.toNumber(),
        costBasisArs.toNumber()
      ),
    };
  };

  // ---- Capital y renta por mes, en cada moneda ----------------------------

  const flowsByMonth = groupByMonth(capitalFlows, ccl);
  const incomeByMonth = groupByMonth(incomeEvents, ccl);

  // ---- Puntos de quiebre ---------------------------------------------------

  // Se valúa a fin de cada mes Y en cada fecha en que entra o sale capital. Sin las
  // fechas intermedias habría que estimar el capital medio del mes con pesos por día
  // (Modified Dietz), y esa estimación se rompe cuando el capital entra sobre el
  // cierre: con compras el 27 y el 31, el capital medio queda en ~9 % del invertido y
  // una caída del 11 % se reporta como −131 %. Valuando en cada operación, cada tramo
  // se mide contra el capital que realmente había, y el problema desaparece.
  const breakpointsByMonth = new Map<MonthKey, Date[]>();
  for (const month of months) breakpointsByMonth.set(month, []);

  for (const flow of capitalFlows) {
    const key = monthKeyOf(flow.date);
    const list = breakpointsByMonth.get(key);
    // Un flujo del último día del mes coincide con el cierre: no agrega un punto nuevo.
    if (list) list.push(toUtcDay(flow.date));
  }

  const valuations: Valuation[] = [];
  /** Índice del cierre de cada mes dentro de `valuations`. */
  const monthEndIndex = new Map<MonthKey, number>();

  for (const month of months) {
    const windowStart = monthStart(month);
    const end = monthEnd(month);
    const dates = [...new Set((breakpointsByMonth.get(month) ?? []).map((d) => d.getTime()))]
      .filter((time) => time < end.getTime())
      .sort((a, b) => a - b)
      .map((time) => new Date(time));

    for (const date of dates) valuations.push(valuateAt(date, month, windowStart));
    monthEndIndex.set(month, valuations.length);
    valuations.push(valuateAt(end, month, windowStart));
  }

  // ---- Rendimientos --------------------------------------------------------

  // Capital que entra o sale en cada fecha exacta, en ambas monedas.
  const flowsByDate = sumByDate(capitalFlows, ccl);

  const subReturnsByMonth = new Map<MonthKey, { ars: Array<number | null>; usd: Array<number | null> }>();
  for (const month of months) subReturnsByMonth.set(month, { ars: [], usd: [] });

  let previousArs = 0;
  let previousUsd = 0;

  for (const valuation of valuations) {
    const flow = flowsByDate.get(valuation.valuationDate.getTime());
    const bucket = subReturnsByMonth.get(valuation.month)!;

    bucket.ars.push(subPeriodReturn(previousArs, valuation.valueArs, flow?.ars ?? 0));
    // La serie en USD se calcula sobre sus propios valores y sus propios flujos
    // convertidos al CCL del día de cada operación. NO se deriva de la serie en
    // ARS restando devaluación: eso arrastra error y da un número distinto.
    bucket.usd.push(subPeriodReturn(previousUsd, valuation.valueUsd, flow?.usd ?? 0));

    previousArs = valuation.valueArs;
    previousUsd = valuation.valueUsd;
  }

  const monthlyArs = months.map((month) => combineSubPeriods(subReturnsByMonth.get(month)!.ars));
  const monthlyUsd = months.map((month) => combineSubPeriods(subReturnsByMonth.get(month)!.usd));

  const cumulativeArs = chainReturns(monthlyArs);
  const cumulativeUsd = chainReturns(monthlyUsd);
  const drawdownArs = drawdownFromCumulative(cumulativeArs);
  const drawdownUsd = drawdownFromCumulative(cumulativeUsd);

  let cumulativeInvestedArs = 0;
  let cumulativeInvestedUsd = 0;
  let cumulativeGainArs = 0;
  let cumulativeGainUsd = 0;

  // Una fila por mes: se toma la valuación del cierre, ignorando los puntos de
  // quiebre intermedios, que solo existen para medir bien los tramos.
  let previousMonthEndArs = 0;
  let previousMonthEndUsd = 0;

  const rows: MonthlyPerformanceRow[] = months.map((month, index) => {
    const valuation = valuations[monthEndIndex.get(month)!]!;
    const monthFlows = flowsByMonth.get(month);
    const monthIncome = incomeByMonth.get(month);

    const netInvestedArs = monthFlows?.ars ?? 0;
    const netInvestedUsd = monthFlows?.usd ?? 0;
    // Ganancia del mes = variación del valor invertido menos el capital que se puso
    // o se sacó. La renta cobrada NO se descuenta acá: ya entró al valor como parte
    // del perímetro, y descontarla borraría justamente la ganancia que hay que medir.
    const gainArs = valuation.valueArs - previousMonthEndArs - netInvestedArs;
    const gainUsd = valuation.valueUsd - previousMonthEndUsd - netInvestedUsd;

    previousMonthEndArs = valuation.valueArs;
    previousMonthEndUsd = valuation.valueUsd;

    cumulativeInvestedArs += netInvestedArs;
    cumulativeInvestedUsd += netInvestedUsd;
    cumulativeGainArs += gainArs;
    cumulativeGainUsd += gainUsd;

    return {
      month,
      valuationDate: valuation.valuationDate.toISOString(),
      cclMonthEnd: valuation.cclMonthEnd,
      valueArs: valuation.valueArs,
      valueUsd: valuation.valueUsd,
      netInvestedArs,
      netInvestedUsd,
      cumulativeInvestedArs,
      cumulativeInvestedUsd,
      incomeArs: monthIncome?.ars ?? 0,
      incomeUsd: monthIncome?.usd ?? 0,
      gainArs,
      gainUsd,
      cumulativeGainArs,
      cumulativeGainUsd,
      monthlyReturnArs: monthlyArs[index] ?? null,
      monthlyReturnUsd: monthlyUsd[index] ?? null,
      cumulativeReturnArs: cumulativeArs[index] ?? null,
      cumulativeReturnUsd: cumulativeUsd[index] ?? null,
      unrealizedReturnPct: valuation.unrealizedReturnPct,
      drawdownArs: drawdownArs[index] ?? 0,
      drawdownUsd: drawdownUsd[index] ?? 0,
      positions: valuation.positions,
      coverage: valuation.coverage,
      staleTickers: valuation.staleTickers,
    };
  });

  const benchmarks = [
    buildInflationBenchmark(
      months,
      inflationRows.map((row) => ({ date: row.date, value: Number(row.value) }))
    ),
    buildIndexBenchmark(
      "MERVAL",
      months,
      new TimeSeries(mervalRows.map((row) => ({ date: row.date, value: Number(row.value) })))
    ),
    buildIndexBenchmark(
      "SP500",
      months,
      new TimeSeries(sp500Rows.map((row) => ({ date: row.date, value: Number(row.value) })))
    ),
  ];

  return {
    portfolioName,
    months: rows,
    benchmarks,
    summary: buildSummary(rows),
    excludedHoldings: findExcludedHoldings(transactions),
    dataQuality: {
      partialMonths: rows.filter((row) => row.coverage === "partial").map((row) => row.month),
      missingCclMonths: rows.filter((row) => row.cclMonthEnd === null).map((row) => row.month),
      lastPriceSyncDate: prices.latestDate()?.toISOString() ?? null,
      seriesFloor: seriesFloor.toISOString(),
    },
  };
}

// ============================================================
// RENTA ACUMULADA
// ============================================================

type DatedAmount = { time: number; amount: Decimal };

/**
 * Expresa cada evento de renta en ARS al CCL **de su propia fecha** y los ordena.
 *
 * Se convierte al momento del cobro y no al cierre del mes porque es un importe
 * histórico: se recibió esa cantidad de pesos ese día. Un evento en dólares sin CCL
 * disponible se descarta en lugar de convertirse a un valor inventado.
 */
function accumulateInArs(events: MonetaryEvent[], ccl: TimeSeries): DatedAmount[] {
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
function sumUpTo(amounts: DatedAmount[], cutoff: number): Decimal {
  let total = new Decimal(0);
  for (const entry of amounts) {
    if (entry.time > cutoff) break;
    total = total.plus(entry.amount);
  }
  return total;
}

// ============================================================
// FECHAS
// ============================================================

function monthKeyOf(date: Date): MonthKey {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Capital neto que entra o sale en cada fecha exacta, en ambas monedas.
 *
 * Es el `F` de cada tramo del TWR: se resta del numerador para que poner plata no se
 * confunda con ganarla. Cada evento se convierte al CCL de su propia fecha.
 */
function sumByDate(
  events: MonetaryEvent[],
  ccl: TimeSeries
): Map<number, { ars: number; usd: number }> {
  const byDate = new Map<number, { ars: number; usd: number }>();

  for (const event of events) {
    const time = toUtcDay(event.date).getTime();
    const entry = byDate.get(time) ?? { ars: 0, usd: 0 };
    const rate = ccl.asOf(event.date)?.value ?? null;

    if (event.currency === "ARS") {
      entry.ars += event.amount;
      if (rate && rate > 0) entry.usd += event.amount / rate;
    } else {
      entry.usd += event.amount;
      if (rate && rate > 0) entry.ars += event.amount * rate;
    }

    byDate.set(time, entry);
  }

  return byDate;
}

// ============================================================
// AGRUPACIÓN MENSUAL
// ============================================================

type MonthAmounts = { ars: number; usd: number };

/**
 * Totales por mes en ambas monedas, para las columnas de la tabla.
 *
 * Cada evento se convierte al CCL **de su propia fecha de operación**, no al del cierre
 * del mes: una compra del día 3 y otra del día 28 en un mes de salto cambiario no valen
 * lo mismo en dólares. Un evento sin CCL disponible no suma a la moneda que no puede
 * expresarse, en vez de convertirse a un valor inventado.
 */
function groupByMonth(events: MonetaryEvent[], ccl: TimeSeries): Map<MonthKey, MonthAmounts> {
  const byMonth = new Map<MonthKey, MonthAmounts>();

  for (const event of events) {
    const key = monthKeyOf(event.date);
    const entry = byMonth.get(key) ?? { ars: 0, usd: 0 };
    const rate = ccl.asOf(event.date)?.value ?? null;

    if (event.currency === "ARS") {
      entry.ars += event.amount;
      if (rate && rate > 0) entry.usd += event.amount / rate;
    } else {
      entry.usd += event.amount;
      if (rate && rate > 0) entry.ars += event.amount * rate;
    }

    byMonth.set(key, entry);
  }

  return byMonth;
}

// ============================================================
// RESUMEN Y EXCLUSIONES
// ============================================================

function buildSummary(rows: MonthlyPerformanceRow[]): PerformanceSummary {
  const last = rows.at(-1);
  if (!last) return emptySummary();

  const extremes = findExtremeMonths(
    rows.map((row) => ({ month: row.month, returnPercent: row.monthlyReturnArs }))
  );
  const measuredMonths = rows.filter((row) => row.monthlyReturnArs !== null).length;

  return {
    currentValueArs: last.valueArs,
    currentValueUsd: last.valueUsd,
    cumulativeReturnArs: last.cumulativeReturnArs,
    cumulativeReturnUsd: last.cumulativeReturnUsd,
    cumulativeGainArs: last.cumulativeGainArs,
    cumulativeGainUsd: last.cumulativeGainUsd,
    netInvestedArs: last.cumulativeInvestedArs,
    netInvestedUsd: last.cumulativeInvestedUsd,
    annualizedReturnArs: annualizeReturn(last.cumulativeReturnArs, measuredMonths),
    annualizedReturnUsd: annualizeReturn(last.cumulativeReturnUsd, measuredMonths),
    maxDrawdownArs: Math.min(0, ...rows.map((row) => row.drawdownArs)),
    maxDrawdownUsd: Math.min(0, ...rows.map((row) => row.drawdownUsd)),
    bestMonthArs: extremes.best,
    worstMonthArs: extremes.worst,
    monthsTracked: measuredMonths,
  };
}

/**
 * Instrumentos con tenencia abierta que quedaron fuera del cálculo.
 *
 * Se muestran en la UI porque el usuario tiene derecho a saber qué parte de su
 * cartera no está en el número que está mirando. Un rendimiento que silenciosamente
 * ignora la mitad del portfolio es peor que no mostrar rendimiento.
 */
function findExcludedHoldings(
  transactions: Array<{
    type: string;
    quantity: { toString(): string };
    instrument: { id: string; ticker: string; name: string; type: InstrumentType } | null;
  }>
): ExcludedHolding[] {
  const netQuantity = new Map<
    string,
    { quantity: Decimal; ticker: string; name: string; type: InstrumentType }
  >();

  for (const tx of transactions) {
    if (!tx.instrument) continue;
    if (ELIGIBLE_TYPES.has(tx.instrument.type)) continue;
    if (tx.type !== "BUY" && tx.type !== "SELL") continue;

    const entry = netQuantity.get(tx.instrument.id) ?? {
      quantity: new Decimal(0),
      ticker: tx.instrument.ticker,
      name: tx.instrument.name,
      type: tx.instrument.type,
    };
    const delta = new Decimal(tx.quantity.toString()).abs();
    entry.quantity = tx.type === "BUY" ? entry.quantity.plus(delta) : entry.quantity.minus(delta);
    netQuantity.set(tx.instrument.id, entry);
  }

  return [...netQuantity.values()]
    .filter((entry) => entry.quantity.gt(0))
    .map((entry) => ({
      ticker: entry.ticker,
      instrumentName: entry.name,
      instrumentType: entry.type,
      reason: EXCLUSION_REASONS[entry.type] ?? "Fuera del alcance del motor de rendimientos.",
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

function emptySummary(): PerformanceSummary {
  return {
    currentValueArs: 0,
    currentValueUsd: 0,
    cumulativeReturnArs: null,
    cumulativeReturnUsd: null,
    cumulativeGainArs: 0,
    cumulativeGainUsd: 0,
    netInvestedArs: 0,
    netInvestedUsd: 0,
    annualizedReturnArs: null,
    annualizedReturnUsd: null,
    maxDrawdownArs: 0,
    maxDrawdownUsd: 0,
    bestMonthArs: null,
    worstMonthArs: null,
    monthsTracked: 0,
  };
}

function emptyReport(portfolioName: string): PerformanceReport {
  return {
    portfolioName,
    months: [],
    benchmarks: [],
    summary: emptySummary(),
    excludedHoldings: [],
    dataQuality: {
      partialMonths: [],
      missingCclMonths: [],
      lastPriceSyncDate: null,
      seriesFloor: null,
    },
  };
}
