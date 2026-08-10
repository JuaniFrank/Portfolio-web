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
 */

import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import type { InstrumentType } from "@/lib/generated/prisma";
import { EOD_PRICE_SOURCE } from "@/lib/market/history-sync";
import { buildHoldings, type TradeForHoldings } from "@/lib/transactions/holdings";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import { buildIndexBenchmark, buildInflationBenchmark } from "./benchmarks";
import { classifyExternalFlows, isUsdCurrency, type ClassifiedFlow } from "./cashflows";
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

  const flows = classifyExternalFlows(
    transactions.map((tx) => ({
      type: tx.type,
      tradeDate: tx.tradeDate,
      netAmount: Number(tx.netAmount),
      currencyCode: tx.currencyCode,
    }))
  );

  const cashEvents = buildCashEvents(transactions);

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
    /** La caja cruda se fue a negativo: faltan aportes en los datos importados. */
    impliedNegativeCash: boolean;
  };

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
    const cash = cashAt(cashEvents, cutoff);
    const cclHit = ccl.asOf(valuationDate);
    const cclMid = cclHit?.value ?? null;

    // La caja se clampea a 0 para valuar, igual que hacía la valuación original:
    // muchos imports traen solo operaciones y ningún depósito, lo que dejaría una
    // caja fuertemente negativa y un valor de cartera absurdo. Pero el hecho de
    // que haya sido negativa se reporta (`impliedNegativeCash`), porque implica
    // que los aportes están incompletos y el rendimiento puede estar sobrestimado.
    const impliedNegativeCash = cash.ars.lt(0) || cash.usd.lt(0);
    const safeCashArs = Decimal.max(0, cash.ars);
    const safeCashUsd = Decimal.max(0, cash.usd);

    let holdingsValueArs = new Decimal(0);
    let costBasisArs = new Decimal(0);
    for (const holding of holdings) {
      holdingsValueArs = holdingsValueArs.plus(new Decimal(holding.marketValueArs));
      costBasisArs = costBasisArs.plus(new Decimal(holding.costBasisArs));
    }

    const valueArs = holdingsValueArs
      .plus(safeCashArs)
      .plus(cclMid && cclMid > 0 ? safeCashUsd.mul(cclMid) : 0);
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

    const hasPortfolio = holdings.length > 0 || !safeCashArs.plus(safeCashUsd).isZero();
    const coverage: MonthCoverage = !hasPortfolio
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
      impliedNegativeCash,
    };
  });

  // ---- Flujos por mes, en cada moneda -------------------------------------

  const flowsByMonth = groupFlowsByMonth(flows, ccl);

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

  let cumulativeFlowArs = 0;
  let cumulativeFlowUsd = 0;
  let cumulativeGainArs = 0;
  let cumulativeGainUsd = 0;

  const rows: MonthlyPerformanceRow[] = valuations.map((valuation, index) => {
    const previous = index > 0 ? valuations[index - 1] : undefined;
    const monthFlows = flowsByMonth.get(valuation.month);

    const netFlowArs = sumFlows(monthFlows?.ars);
    const netFlowUsd = sumFlows(monthFlows?.usd);
    // Ganancia del mes = variación de valor menos lo que entró/salió por caja.
    const gainArs = valuation.valueArs - (previous?.valueArs ?? 0) - netFlowArs;
    const gainUsd = valuation.valueUsd - (previous?.valueUsd ?? 0) - netFlowUsd;

    cumulativeFlowArs += netFlowArs;
    cumulativeFlowUsd += netFlowUsd;
    cumulativeGainArs += gainArs;
    cumulativeGainUsd += gainUsd;

    return {
      month: valuation.month,
      valuationDate: valuation.valuationDate.toISOString(),
      cclMonthEnd: valuation.cclMonthEnd,
      valueArs: valuation.valueArs,
      valueUsd: valuation.valueUsd,
      netFlowArs,
      netFlowUsd,
      cumulativeFlowArs,
      cumulativeFlowUsd,
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
      impliedNegativeCash: valuations.some((valuation) => valuation.impliedNegativeCash),
      seriesFloor: seriesFloor.toISOString(),
    },
  };
}

// ============================================================
// CAJA
// ============================================================

type CashEvent = { time: number; ars: Decimal; usd: Decimal };

/**
 * Convierte transacciones en deltas de caja acumulables.
 *
 * Mismo criterio que la valuación original (`calculatePortfolioValuation`) para que
 * el valor de hoy siga siendo consistente con el dashboard.
 */
function buildCashEvents(
  transactions: Array<{
    type: string;
    tradeDate: Date;
    netAmount: { toString(): string };
    currencyCode: string;
  }>
): CashEvent[] {
  const events: CashEvent[] = [];

  for (const tx of transactions) {
    const magnitude = new Decimal(tx.netAmount.toString()).abs();
    if (magnitude.isZero()) continue;

    let delta: Decimal | null = null;
    switch (tx.type) {
      case "DEPOSIT":
      case "TRANSFER_IN":
      case "SELL":
      case "DIVIDEND_CASH":
      case "COUPON":
      case "AMORTIZATION":
      case "INTEREST":
        delta = magnitude;
        break;
      case "WITHDRAWAL":
      case "TRANSFER_OUT":
      case "BUY":
      case "FEE":
      case "TAX_WITHHOLDING":
        delta = magnitude.neg();
        break;
      default:
        delta = null;
    }
    if (!delta) continue;

    const isUsd = isUsdCurrency(tx.currencyCode);
    events.push({
      time: tx.tradeDate.getTime(),
      ars: isUsd ? new Decimal(0) : delta,
      usd: isUsd ? delta : new Decimal(0),
    });
  }

  return events.sort((a, b) => a.time - b.time);
}

function cashAt(events: CashEvent[], cutoff: number): { ars: Decimal; usd: Decimal } {
  let ars = new Decimal(0);
  let usd = new Decimal(0);
  for (const event of events) {
    if (event.time > cutoff) break;
    ars = ars.plus(event.ars);
    usd = usd.plus(event.usd);
  }
  return { ars, usd };
}

// ============================================================
// FLUJOS
// ============================================================

type MonthFlows = { ars: ExternalFlow[]; usd: ExternalFlow[] };

/**
 * Agrupa flujos externos por mes y los expresa en ambas monedas.
 *
 * Cada flujo se convierte al CCL **de su propia fecha de operación**, no al del cierre
 * del mes: un aporte del día 3 y otro del día 28 en un mes de salto cambiario no valen
 * lo mismo en dólares. Un flujo sin CCL disponible se omite de la serie en la moneda
 * que no puede expresarse, en vez de convertirse a un valor inventado.
 */
function groupFlowsByMonth(
  flows: ClassifiedFlow[],
  ccl: TimeSeries
): Map<MonthKey, MonthFlows> {
  const byMonth = new Map<MonthKey, MonthFlows>();

  for (const flow of flows) {
    const key = `${flow.date.getUTCFullYear()}-${String(flow.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const entry = byMonth.get(key) ?? { ars: [], usd: [] };
    const day = dayOfMonth(flow.date);
    const rate = ccl.asOf(flow.date)?.value ?? null;

    if (flow.currency === "ARS") {
      entry.ars.push({ day, amount: flow.amount });
      if (rate && rate > 0) entry.usd.push({ day, amount: flow.amount / rate });
    } else {
      entry.usd.push({ day, amount: flow.amount });
      if (rate && rate > 0) entry.ars.push({ day, amount: flow.amount * rate });
    }

    byMonth.set(key, entry);
  }

  return byMonth;
}

function sumFlows(flows: ExternalFlow[] | undefined): number {
  return (flows ?? []).reduce((total, flow) => total + flow.amount, 0);
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
    netFlowArs: last.cumulativeFlowArs,
    netFlowUsd: last.cumulativeFlowUsd,
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
    netFlowArs: 0,
    netFlowUsd: 0,
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
      impliedNegativeCash: false,
      seriesFloor: null,
    },
  };
}
