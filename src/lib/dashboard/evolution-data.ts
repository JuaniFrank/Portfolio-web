/**
 * Carga los insumos del replay y delega en `buildEvolutionSeries`.
 *
 * Misma división que el resto del dashboard: acá vive todo lo que habla con Prisma y la
 * lógica de cálculo queda en un módulo puro y testeado (`evolution.ts`).
 *
 * Las consultas son las mismas que usa `/rendimientos` menos los benchmarks: precios EOD
 * de los instrumentos elegibles, CCL histórico y eventos corporativos — más un ensanche
 * local para ONs (ver `EVOLUTION_INSTRUMENT_TYPES`).
 */

import { prisma } from "@/lib/prisma";
import type { InstrumentType } from "@/lib/generated/prisma";
import { EOD_PRICE_SOURCE } from "@/lib/market/history-sync";
import { fetchLiveOverlayInputs } from "@/lib/market/live-quotes";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import {
  classifyIncome,
  isUsdCurrency,
  type MonetaryEvent,
  type TransactionForFlows,
} from "@/lib/rendimientos/cashflows";
import { toUtcDay } from "@/lib/rendimientos/months";
import { overlayLiveCcl, overlayLivePrices } from "@/lib/rendimientos/live-overlay";
import { DEFAULT_MARKET_TIME_ZONE, marketDayOf } from "@/lib/rendimientos/market-day";
import { loadCclSeries } from "@/lib/market/ccl-history";
import { PriceIndex, TimeSeries } from "@/lib/rendimientos/price-series";
import { PERFORMANCE_INSTRUMENT_TYPES } from "@/lib/rendimientos/types";
import { accumulateInArs } from "@/lib/rendimientos/valuation";
import type { BondTermsForProjection } from "@/lib/bonds/cashflows";
import {
  resolveBondSchedule,
  type BondScheduleRow,
  type StoredBondSchedule,
} from "@/lib/bonds/schedule-source";
import {
  buildBondDailyPriceSeries,
  type BondRealSnapshot,
  type BondResidualRow,
} from "./bond-price-series";
import {
  buildEvolutionSeries,
  type EvolutionInstrument,
  type InstrumentFlow,
  type PortfolioEvolution,
} from "./evolution";

/**
 * Perímetro de este loader: el de `/rendimientos` (`PERFORMANCE_INSTRUMENT_TYPES`) más
 * ONs. Es un ensanche LOCAL a este archivo — `/rendimientos` (`series.ts`) tiene su
 * propio `ELIGIBLE_TYPES` y no se toca. Las ONs entran acá porque este replay tiene de
 * dónde sacarles un precio diario, real o estimado (ver `bond-price-series.ts`), cosa
 * que `/rendimientos` todavía no tiene.
 */
const EVOLUTION_INSTRUMENT_TYPES: InstrumentType[] = [...PERFORMANCE_INSTRUMENT_TYPES, "ON"];
const ELIGIBLE_TYPES = new Set<InstrumentType>(EVOLUTION_INSTRUMENT_TYPES);
const ON_TYPE: InstrumentType = "ON";

const EMPTY: PortfolioEvolution = {
  hasData: false,
  series: { daily: [], weekly: [], monthly: [] },
  firstDate: null,
  lastDate: null,
  instruments: [],
  trades: [],
};

/**
 * @param ccl - Serie de CCL ya cargada. El dashboard la comparte con la valuación de
 *   posiciones para no leer dos veces la misma tabla; sin ella se lee acá.
 * @param marketTimeZone - Calendario que decide qué día es "hoy" para el precio en vivo.
 */
export async function loadPortfolioEvolution(
  portfolioIds: string[],
  ccl?: TimeSeries,
  marketTimeZone: string = DEFAULT_MARKET_TIME_ZONE
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

  // Ticker+type+name de cada instrumento elegible: el ticker+type lo necesita el
  // overlay en vivo para matchear contra data912, el name pobla `instruments` — y ya
  // está en `transactions`, no hace falta otra query.
  const eligibleInstruments = [
    ...new Map(
      transactions
        .filter((tx) => tx.instrument && ELIGIBLE_TYPES.has(tx.instrument.type))
        .map((tx) => [
          tx.instrument!.id,
          {
            id: tx.instrument!.id,
            ticker: tx.instrument!.ticker,
            name: tx.instrument!.name,
            type: tx.instrument!.type,
          },
        ])
    ).values(),
  ];

  if (eligibleInstruments.length === 0) return EMPTY;

  // Las ONs quedan afuera del overlay en vivo genérico y de la query de precios EOD:
  // data912 las cotiza ARS por 100 VN (`VN_QUOTE_BASIS`), mientras que el overlay y
  // `EOD_PRICE_SOURCE` asumen ARS por unidad — mezclarlas ahí inflaría el precio en
  // vivo de una ON 100x. Se resuelven aparte, más abajo, con `bond-price-series.ts`.
  const equityInstruments = eligibleInstruments.filter((instrument) => instrument.type !== ON_TYPE);
  const onInstruments = eligibleInstruments.filter((instrument) => instrument.type === ON_TYPE);
  const equityInstrumentIds = equityInstruments.map((instrument) => instrument.id);
  const onInstrumentIds = onInstruments.map((instrument) => instrument.id);

  const [priceRows, cclLoaded, eventRows, liveOverlay, onSnapshotRows, onTermsRows] =
    await Promise.all([
      equityInstrumentIds.length > 0
        ? prisma.priceCache.findMany({
            where: { instrumentId: { in: equityInstrumentIds }, source: EOD_PRICE_SOURCE },
            orderBy: { datetime: "asc" },
            select: { instrumentId: true, datetime: true, close: true },
          })
        : Promise.resolve([]),
      ccl ?? loadCclSeries(),
      prisma.corporateEvent.findMany({
        where: { instrumentId: { in: eligibleInstruments.map((instrument) => instrument.id) } },
        orderBy: { effectiveDate: "asc" },
        select: {
          instrumentId: true,
          eventType: true,
          effectiveDate: true,
          numerator: true,
          denominator: true,
        },
      }),
      fetchLiveOverlayInputs(equityInstruments),
      onInstrumentIds.length > 0
        ? prisma.priceCache.findMany({
            where: { instrumentId: { in: onInstrumentIds }, source: "data912" },
            orderBy: { datetime: "asc" },
            select: { instrumentId: true, datetime: true, close: true },
          })
        : Promise.resolve([]),
      onInstrumentIds.length > 0
        ? prisma.instrument.findMany({
            where: { id: { in: onInstrumentIds } },
            select: { id: true, bondTerms: true, bondSchedule: true },
          })
        : Promise.resolve([]),
    ]);

  // "Hoy" para el overlay: un solo corte para precios y CCL.
  const today = marketDayOf(new Date(), marketTimeZone);

  const { rows: overlaidPriceRows, liveInstrumentIds } = overlayLivePrices(
    priceRows.map((row) => ({
      instrumentId: row.instrumentId,
      date: row.datetime,
      close: Number(row.close),
    })),
    liveOverlay.priceQuotes,
    today
  );

  // Sea la compartida por el dashboard o la que se leyó acá, de acá en más es una sola.
  // El overlay es idempotente: si ya tiene un punto de hoy (por ejemplo porque
  // `resolveCclRate` ya lo persistió), no agrega nada.
  const cclOverlay = overlayLiveCcl(cclLoaded.all(), liveOverlay.cclMid, today);
  const cclSeries = cclOverlay.isLive ? new TimeSeries(cclOverlay.points) : cclLoaded;

  // Las ruedas: los días en que al menos un instrumento de renta variable cerró
  // (incluye el overlay en vivo de hoy, si lo hubo). Se calculan ANTES de sumar los
  // precios de ONs y también sirven como los días a cubrir en
  // `buildBondDailyPriceSeries`: no hace falta un calendario aparte para ONs.
  // `overlaidPriceRows` empieza ordenado por fecha y el punto en vivo se agrega al
  // final, así que el Set no preserva el orden acá: se ordena.
  const tradingDays = [
    ...new Set(overlaidPriceRows.map((row) => toUtcDay(row.date).getTime())),
  ]
    .sort((a, b) => a - b)
    .map((time) => new Date(time));

  // ---- Precio diario de ONs: real (data912) o valor técnico estimado --------------

  const onSnapshotsByInstrument = new Map<string, BondRealSnapshot[]>();
  for (const row of onSnapshotRows) {
    const list = onSnapshotsByInstrument.get(row.instrumentId) ?? [];
    list.push({ datetime: row.datetime, close: Number(row.close) });
    onSnapshotsByInstrument.set(row.instrumentId, list);
  }
  const onTermsById = new Map(onTermsRows.map((row) => [row.id, row]));

  const bondPriceRows: Array<{ instrumentId: string; date: Date; close: number }> = [];
  /** Días (UTC ms) marcados como valor técnico estimado, por instrumento — alimenta
   * `PositionDetail.priceEstimated` en `valuatePortfolioAt`. */
  const estimatedPriceDays = new Map<string, Set<number>>();

  for (const instrument of onInstruments) {
    const row = onTermsById.get(instrument.id);

    const terms: BondTermsForProjection | null = row?.bondTerms
      ? {
          faceValue: row.bondTerms.faceValue.toString(),
          currencyCode: row.bondTerms.currencyCode,
          rateType: row.bondTerms.rateType as "FIXED" | "FLOATING",
          couponRate: row.bondTerms.couponRate.toString(),
          couponFrequencyMonths: row.bondTerms.couponFrequencyMonths,
          issueDate: row.bondTerms.issueDate,
          maturityDate: row.bondTerms.maturityDate,
          amortizationSchedule: row.bondTerms.amortizationSchedule,
          dayCountConvention: row.bondTerms.dayCountConvention,
        }
      : null;

    const storedSchedule: StoredBondSchedule | null = row?.bondSchedule
      ? { rows: row.bondSchedule.rows as unknown as BondScheduleRow[] }
      : null;

    const resolved = resolveBondSchedule(storedSchedule, terms, today);

    // El caso "derived" (sin `BondSchedule` guardado, proyectado desde `BondTerms`)
    // solo trae los flujos FUTUROS desde `today`: no alcanza para reconstruir el
    // residual de todo el histórico, así que se asume par completo (100, sin
    // amortizar) para esos días — una simplificación deliberada. Las dos ONs reales de
    // este dashboard (EAC4O, MCC3O) tienen `BondSchedule` guardado y siempre resuelven
    // a "docta-schedule", así que no las afecta; un ON sin schedule guardado ni
    // `BondTerms` ("none") cae en el mismo residual completo.
    const schedule: BondResidualRow[] =
      resolved.source === "docta-schedule"
        ? resolved.rows.map((r) => ({ paymentDate: r.paymentDate, residualValue: r.residualValue }))
        : [];

    const dailyPrices = buildBondDailyPriceSeries({
      days: tradingDays,
      snapshots: onSnapshotsByInstrument.get(instrument.id) ?? [],
      schedule,
      ccl: cclSeries,
    });

    const estimatedDays = new Set<number>();
    for (const point of dailyPrices) {
      const date = new Date(`${point.date}T00:00:00.000Z`);
      bondPriceRows.push({ instrumentId: instrument.id, date, close: point.priceArsPerVn });
      if (point.estimated) estimatedDays.add(date.getTime());
    }
    if (estimatedDays.size > 0) estimatedPriceDays.set(instrument.id, estimatedDays);
  }

  const prices = new PriceIndex([...overlaidPriceRows, ...bondPriceRows]);

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

    const rawNetAmount = Number(tx.netAmount);
    const isUsdTrade = isUsdCurrency(tx.currencyCode);
    // El CCL del día de la operación, no el del cierre del período: es lo que hace que
    // la ganancia en dólares del tramo mida el tipo de cambio en vez de cancelarlo.
    const rate = cclSeries.asOf(tx.tradeDate)?.value ?? null;

    // Las ONs conocidas son hard-dollar (USD 1 por VN): `netAmount` viene en USD, pero
    // `buildHoldings` no distingue moneda — asume ARS sin condicional (ver
    // `computePositionFromTrades`, que suma `|netAmount|` directo al costo). Se
    // convierte acá, al CCL del día de la operación, antes de que el trade entre al
    // replay; `costBasisUsd` sale de dividir por ese mismo CCL más abajo, así que el
    // viaje ida y vuelta reproduce el USD original sin pérdida. Sin CCL para esa fecha
    // (no debería pasar: el histórico cubre bien atrás de cualquier compra real) se
    // deja el monto crudo como último recurso en vez de descartar la operación.
    const netAmountArs = isUsdTrade && rate && rate > 0 ? rawNetAmount * rate : rawNetAmount;

    trades.push({
      instrumentId: tx.instrument.id,
      ticker: tx.instrument.ticker,
      instrumentType: tx.instrument.type,
      instrumentName: tx.instrument.name,
      type: tx.type,
      quantity: tx.quantity.toString(),
      price: tx.price.toString(),
      netAmount: netAmountArs.toString(),
      tradeDate: tx.tradeDate.toISOString(),
    });

    // El signo lo fija el tipo, no el signo guardado: compra suma capital, venta lo
    // saca. Se toma como ARS igual que `buildHoldings` al armar el costo, para que la
    // resta contra la variación de valor cancele (ver `evolution.ts`).
    const amount = Math.abs(netAmountArs);
    const amountArs = tx.type === "BUY" ? amount : -amount;
    // Para USD nativo se usa el monto original, no `amountArs / rate`: evita el
    // redondeo del viaje de ida y vuelta y es exactamente lo que se pagó/cobró.
    const amountUsd = isUsdTrade
      ? tx.type === "BUY"
        ? Math.abs(rawNetAmount)
        : -Math.abs(rawNetAmount)
      : rate && rate > 0
        ? amountArs / rate
        : null;

    flows.push({
      instrumentId: tx.instrument.id,
      time: toUtcDay(tx.tradeDate).getTime(),
      amountArs,
      amountUsd,
    });
  }

  if (trades.length === 0) return EMPTY;

  const forFlows: TransactionForFlows[] = transactions.map((tx) => ({
    type: tx.type,
    tradeDate: tx.tradeDate,
    netAmount: Number(tx.netAmount),
    currencyCode: tx.currencyCode,
    instrumentEligible: tx.instrument ? ELIGIBLE_TYPES.has(tx.instrument.type) : false,
    // Para atribuir la renta (dividendos, cupones, amortizaciones) al instrumento que la
    // generó — ver `incomeArsByInstrument` más abajo. `/rendimientos` no lo necesita
    // (agrega toda la renta al perímetro), así que este campo es opcional en el tipo.
    instrumentId: tx.instrument?.id ?? null,
  }));

  const from = toUtcDay(new Date(trades[0]!.tradeDate));
  const to = today;

  const instruments: EvolutionInstrument[] = eligibleInstruments.map((instrument) => ({
    ticker: instrument.ticker,
    name: instrument.name,
    type: instrument.type as "STOCK_AR" | "CEDEAR" | "ON",
  }));

  // La renta cobrada vive dentro del perímetro: un dividendo (o un cupón/amortización de
  // ON) es retorno generado, no plata que se fue. `classifyIncome` ya sabe distinguir
  // ARS/USD por `currencyCode`; se agrupa por instrumento ANTES de convertir a ARS
  // (`accumulateInArs` por grupo) para poder atribuirle a cada posición su propia renta
  // acumulada en `buildPositionBreakdown` — el agregado (`incomeArsByDate`) sigue
  // calculándose sobre todos los eventos, sin agrupar, como antes.
  const incomeEvents = classifyIncome(forFlows);
  const incomeEventsByInstrument = new Map<string, MonetaryEvent[]>();
  for (const event of incomeEvents) {
    if (!event.instrumentId) continue;
    const list = incomeEventsByInstrument.get(event.instrumentId) ?? [];
    list.push(event);
    incomeEventsByInstrument.set(event.instrumentId, list);
  }
  const incomeArsByInstrument = new Map(
    [...incomeEventsByInstrument.entries()].map(([instrumentId, events]) => [
      instrumentId,
      accumulateInArs(events, cclSeries),
    ])
  );

  return buildEvolutionSeries({
    trades,
    prices,
    ccl: cclSeries,
    eventsByInstrument,
    incomeArsByDate: accumulateInArs(incomeEvents, cclSeries),
    incomeArsByInstrument,
    liveInstrumentIds,
    estimatedPriceDays,
    flows,
    from,
    to,
    tradingDays,
    instruments,
  });
}
