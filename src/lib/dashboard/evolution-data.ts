/**
 * Carga los insumos del replay y delega en `buildEvolutionSeries`.
 *
 * Misma división que el resto del dashboard: acá vive todo lo que habla con Prisma y la
 * lógica de cálculo queda en un módulo puro y testeado (`evolution.ts`).
 *
 * Las consultas son las mismas que usa `/rendimientos` menos los benchmarks: precios EOD
 * de los instrumentos elegibles, CCL histórico y eventos corporativos.
 */

import { prisma } from "@/lib/prisma";
import type { InstrumentType } from "@/lib/generated/prisma";
import { EOD_PRICE_SOURCE } from "@/lib/market/history-sync";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import {
  classifyIncome,
  type TransactionForFlows,
} from "@/lib/rendimientos/cashflows";
import { toUtcDay } from "@/lib/rendimientos/months";
import { loadCclSeries } from "@/lib/market/ccl-history";
import { PriceIndex, TimeSeries } from "@/lib/rendimientos/price-series";
import { PERFORMANCE_INSTRUMENT_TYPES } from "@/lib/rendimientos/types";
import { accumulateInArs } from "@/lib/rendimientos/valuation";
import {
  buildEvolutionSeries,
  type InstrumentFlow,
  type PortfolioEvolution,
} from "./evolution";

const ELIGIBLE_TYPES = new Set<InstrumentType>(PERFORMANCE_INSTRUMENT_TYPES);

const EMPTY: PortfolioEvolution = {
  hasData: false,
  series: { daily: [], weekly: [], monthly: [] },
  firstDate: null,
  lastDate: null,
};

function todayUtc(): Date {
  return toUtcDay(new Date());
}

/**
 * @param ccl - Serie de CCL ya cargada. El dashboard la comparte con la valuación de
 *   posiciones para no leer dos veces la misma tabla; sin ella se lee acá.
 */
export async function loadPortfolioEvolution(
  portfolioIds: string[],
  ccl?: TimeSeries
): Promise<PortfolioEvolution> {
  if (portfolioIds.length === 0) return EMPTY;

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
      instrument: { select: { id: true, ticker: true, name: true, type: true } },
    },
  });

  if (transactions.length === 0) return EMPTY;

  const eligibleInstrumentIds = [
    ...new Set(
      transactions
        .filter((tx) => tx.instrument && ELIGIBLE_TYPES.has(tx.instrument.type))
        .map((tx) => tx.instrument!.id)
    ),
  ];

  if (eligibleInstrumentIds.length === 0) return EMPTY;

  const [priceRows, cclLoaded, eventRows] = await Promise.all([
    prisma.priceCache.findMany({
      where: { instrumentId: { in: eligibleInstrumentIds }, source: EOD_PRICE_SOURCE },
      orderBy: { datetime: "asc" },
      select: { instrumentId: true, datetime: true, close: true },
    }),
    ccl ?? loadCclSeries(),
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

  // Sea la compartida por el dashboard o la que se leyó acá, de acá en más es una sola.
  const cclSeries = cclLoaded;

  const prices = new PriceIndex(
    priceRows.map((row) => ({
      instrumentId: row.instrumentId,
      date: row.datetime,
      close: Number(row.close),
    }))
  );

  // Las ruedas: los días en que al menos un instrumento cerró. `priceRows` ya viene
  // ordenado por fecha, así que el Set preserva el orden ascendente.
  const tradingDays = [
    ...new Set(priceRows.map((row) => toUtcDay(row.datetime).getTime())),
  ].map((time) => new Date(time));

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
  const flows: InstrumentFlow[] = [];

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

    // El signo lo fija el tipo, no el signo guardado: compra suma capital, venta lo
    // saca. Se toma como ARS igual que `buildHoldings` al armar el costo, para que la
    // resta contra la variación de valor cancele (ver `evolution.ts`).
    const amount = Math.abs(Number(tx.netAmount));
    const amountArs = tx.type === "BUY" ? amount : -amount;
    // El CCL del día de la operación, no el del cierre del período: es lo que hace que
    // la ganancia en dólares del tramo mida el tipo de cambio en vez de cancelarlo.
    const rate = cclSeries.asOf(tx.tradeDate)?.value ?? null;

    flows.push({
      instrumentId: tx.instrument.id,
      time: toUtcDay(tx.tradeDate).getTime(),
      amountArs,
      amountUsd: rate && rate > 0 ? amountArs / rate : null,
    });
  }

  if (trades.length === 0) return EMPTY;

  const forFlows: TransactionForFlows[] = transactions.map((tx) => ({
    type: tx.type,
    tradeDate: tx.tradeDate,
    netAmount: Number(tx.netAmount),
    currencyCode: tx.currencyCode,
    instrumentEligible: tx.instrument ? ELIGIBLE_TYPES.has(tx.instrument.type) : false,
  }));

  const from = toUtcDay(new Date(trades[0]!.tradeDate));
  const to = todayUtc();

  return buildEvolutionSeries({
    trades,
    prices,
    ccl: cclSeries,
    eventsByInstrument,
    // La renta cobrada vive dentro del perímetro: un dividendo es retorno generado, no
    // plata que se fue.
    incomeArsByDate: accumulateInArs(classifyIncome(forFlows), cclSeries),
    flows,
    from,
    to,
    tradingDays,
  });
}
