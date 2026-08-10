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
  dayOfMonth,
  daysInMonth,
  enumerateMonths,
  monthEnd,
  monthStart,
  type MonthKey,
} from "./months";
import { PriceIndex, TimeSeries } from "./price-series";
import {
  annualizeReturn,
  chainReturns,
  drawdownFromCumulative,
  findExtremeMonths,
  modifiedDietzReturn,
  unrealizedReturn,
  type ExternalFlow,
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

  // ---- Valuación mes a mes -------------------------------------------------

  type MonthValuation = {
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

  const valuations: MonthValuation[] = months.map((month) => {
    const valuationDate = monthEnd(month);
    const windowStart = monthStart(month);
    const cutoff = valuationDate.getTime();

    const tradesToDate = trades.filter(
      (trade) => new Date(trade.tradeDate).getTime() <= cutoff
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
  });

  // ---- Capital y renta por mes, en cada moneda ----------------------------

  const flowsByMonth = groupByMonth(capitalFlows, ccl);
  const incomeByMonth = groupByMonth(incomeEvents, ccl);

  // ---- Rendimientos --------------------------------------------------------

  const monthlyArs: Array<number | null> = [];
  const monthlyUsd: Array<number | null> = [];

  valuations.forEach((valuation, index) => {
    const previous = index > 0 ? valuations[index - 1] : undefined;
    const monthFlows = flowsByMonth.get(valuation.month);
    const days = daysInMonth(valuation.month);

    monthlyArs.push(
      modifiedDietzReturn({
        startValue: previous?.valueArs ?? 0,
        endValue: valuation.valueArs,
        flows: monthFlows?.ars ?? [],
        daysInMonth: days,
      })
    );

    // La serie en USD se calcula sobre sus propios valores y sus propios flujos
    // convertidos al CCL del día de cada operación. NO se deriva de la serie en
    // ARS restando devaluación: eso arrastra error y da un número distinto.
    monthlyUsd.push(
      modifiedDietzReturn({
        startValue: previous?.valueUsd ?? 0,
        endValue: valuation.valueUsd,
        flows: monthFlows?.usd ?? [],
        daysInMonth: days,
      })
    );
  });

  const cumulativeArs = chainReturns(monthlyArs);
  const cumulativeUsd = chainReturns(monthlyUsd);
  const drawdownArs = drawdownFromCumulative(cumulativeArs);
  const drawdownUsd = drawdownFromCumulative(cumulativeUsd);

  let cumulativeInvestedArs = 0;
  let cumulativeInvestedUsd = 0;
  let cumulativeGainArs = 0;
  let cumulativeGainUsd = 0;

  const rows: MonthlyPerformanceRow[] = valuations.map((valuation, index) => {
    const previous = index > 0 ? valuations[index - 1] : undefined;
    const monthFlows = flowsByMonth.get(valuation.month);
    const monthIncome = incomeByMonth.get(valuation.month);

    const netInvestedArs = sumAmounts(monthFlows?.ars);
    const netInvestedUsd = sumAmounts(monthFlows?.usd);
    // Ganancia del mes = variación del valor invertido menos el capital que se puso
    // o se sacó. La renta cobrada NO se descuenta acá: ya entró al valor como parte
    // del perímetro, y descontarla borraría justamente la ganancia que hay que medir.
    const gainArs = valuation.valueArs - (previous?.valueArs ?? 0) - netInvestedArs;
    const gainUsd = valuation.valueUsd - (previous?.valueUsd ?? 0) - netInvestedUsd;

    cumulativeInvestedArs += netInvestedArs;
    cumulativeInvestedUsd += netInvestedUsd;
    cumulativeGainArs += gainArs;
    cumulativeGainUsd += gainUsd;

    return {
      month: valuation.month,
      valuationDate: valuation.valuationDate.toISOString(),
      cclMonthEnd: valuation.cclMonthEnd,
      valueArs: valuation.valueArs,
      valueUsd: valuation.valueUsd,
      netInvestedArs,
      netInvestedUsd,
      cumulativeInvestedArs,
      cumulativeInvestedUsd,
      incomeArs: sumAmounts(monthIncome?.ars),
      incomeUsd: sumAmounts(monthIncome?.usd),
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
    if (event.currency === "ARS") {
      amounts.push({ time: event.date.getTime(), amount: new Decimal(event.amount) });
      continue;
    }
    const rate = ccl.asOf(event.date)?.value ?? null;
    if (!rate || rate <= 0) continue;
    amounts.push({ time: event.date.getTime(), amount: new Decimal(event.amount * rate) });
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
// AGRUPACIÓN MENSUAL
// ============================================================

type MonthAmounts = { ars: ExternalFlow[]; usd: ExternalFlow[] };

/**
 * Agrupa eventos por mes y los expresa en ambas monedas, con su día dentro del mes.
 *
 * Cada evento se convierte al CCL **de su propia fecha de operación**, no al del cierre
 * del mes: una compra del día 3 y otra del día 28 en un mes de salto cambiario no valen
 * lo mismo en dólares. Un evento sin CCL disponible se omite de la serie en la moneda
 * que no puede expresarse, en vez de convertirse a un valor inventado.
 *
 * El `day` es el `d_i` que Modified Dietz usa para ponderar cuánto tiempo estuvo
 * invertido ese capital.
 */
function groupByMonth(
  events: MonetaryEvent[],
  ccl: TimeSeries
): Map<MonthKey, MonthAmounts> {
  const byMonth = new Map<MonthKey, MonthAmounts>();

  for (const event of events) {
    const key = `${event.date.getUTCFullYear()}-${String(event.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const entry = byMonth.get(key) ?? { ars: [], usd: [] };
    const day = dayOfMonth(event.date);
    const rate = ccl.asOf(event.date)?.value ?? null;

    if (event.currency === "ARS") {
      entry.ars.push({ day, amount: event.amount });
      if (rate && rate > 0) entry.usd.push({ day, amount: event.amount / rate });
    } else {
      entry.usd.push({ day, amount: event.amount });
      if (rate && rate > 0) entry.ars.push({ day, amount: event.amount * rate });
    }

    byMonth.set(key, entry);
  }

  return byMonth;
}

function sumAmounts(amounts: ExternalFlow[] | undefined): number {
  return (amounts ?? []).reduce((total, entry) => total + entry.amount, 0);
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
