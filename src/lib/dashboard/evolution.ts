/**
 * Serie de evolución del portfolio para el dashboard: valor a lo largo del tiempo, con
 * las posiciones que más aportaron y más restaron en cada período.
 *
 * ## Por qué se reconstruye en vez de leer `PortfolioSnapshot`
 *
 * Los snapshots guardan el *resultado* de una valuación del día en que corrió el cron,
 * así que solo existen desde que el cron empezó a correr y no se pueden completar hacia
 * atrás: `calculatePortfolioValuation` no acepta una fecha, solo sabe valuar "ahora".
 * Acá se replayan las transacciones contra las series históricas de precios y CCL, que
 * son los *insumos*. Eso da tres cosas que el snapshot no puede dar: histórico completo
 * desde la primera operación, recálculo automático al corregir una operación vieja, y
 * granularidad libre.
 *
 * ## La atribución por posición
 *
 * La ganancia del período **no** es `V_t − V_{t−1}`: con un aporte de por medio eso mide
 * variación de saldo, no rendimiento. Comprar $1M en una cartera de $1M aparecería como
 * +100 %. Se netea el capital que entró o salió:
 *
 *     ganancia = (V_t − V_{t−1}) − flujoNeto
 *
 * Es la misma convención que ya usa el motor mensual a nivel portfolio (`gainArs` en
 * `series.ts`), aplicada por instrumento. Funciona en los tres casos borde: posición
 * abierta en el período (V_{t−1} = 0, flujo = costo), cerrada (V_t = 0, flujo = −monto
 * cobrado) y ampliada (flujo = la compra nueva).
 *
 * `netAmount` se toma como ARS, igual que hace `buildHoldings` al armar `costBasisArs`.
 * No es una omisión: si el flujo usara otra convención que el valor, la resta dejaría de
 * cancelar y la atribución daría cualquier cosa. Todas las operaciones de instrumentos
 * elegibles están en ARS.
 *
 * El perímetro es el de `/rendimientos`: solo `PERFORMANCE_INSTRUMENT_TYPES`. Renta fija
 * y letras no tienen serie de precios, así que quedan afuera y se avisan.
 */

import {
  bucketByLastDay,
  bucketEndpoints,
  type Granularity,
} from "@/lib/rendimientos/timeline";
import type { PriceIndex, TimeSeries } from "@/lib/rendimientos/price-series";
import { subPeriodReturn } from "@/lib/rendimientos/returns";
import type { MonthCoverage, PositionDetail } from "@/lib/rendimientos/types";
import {
  type PortfolioValuation,
  type ReplayInputs,
  valuatePortfolioAt,
} from "@/lib/rendimientos/valuation";

/** Cuántas posiciones se muestran por lado en el detalle de cada período. */
export const MOVERS_PER_SIDE = 4;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Capital movido por una operación: positivo compra, negativo venta. En ARS. */
export type InstrumentFlow = {
  instrumentId: string;
  /** Día UTC de la operación, en ms. */
  time: number;
  amountArs: number;
};

export type EvolutionInputs = ReplayInputs & {
  flows: InstrumentFlow[];
  /** Primer cierre a reportar. Normalmente la primera operación elegible. */
  from: Date;
  /** Último cierre a reportar. Normalmente hoy. */
  to: Date;
  /**
   * Días UTC con al menos una barra EOD, ascendentes: las ruedas.
   *
   * La serie se apoya en estos días y no en el calendario. Un sábado no tiene precio
   * nuevo, así que valuarlo agrega un escalón plano que no pasó, y un fin de mes en
   * domingo valuaría todo con precios del viernes marcando el bucket como incompleto
   * sin que falte nada.
   *
   * Si viene vacío se cae al calendario completo: la cartera queda valuada a costo,
   * que es poco, pero es mejor que no mostrar nada.
   */
  tradingDays: Date[];
};

export type EvolutionMover = {
  ticker: string;
  /** Ganancia del período neta de aportes y retiros. */
  pnlArs: number;
  pnlUsd: number;
  /** Variación del precio en el período. `null` si no hay cierre anterior con qué comparar. */
  pricePercent: number | null;
  /** El precio del cierre vino por arrastre: el número no es del período. */
  priceIsStale: boolean;
  /**
   * Hubo compras o ventas del instrumento en el período.
   *
   * Importa para leer la fila: con una operación en el medio, `pnlArs` y `pricePercent`
   * pueden discrepar de signo sin que ninguno esté mal. Comprar por encima del precio de
   * cierre deja la posición en rojo aunque el ticker haya subido, porque lo que se mide
   * es el resultado sobre el capital y no la variación del papel.
   */
  hadFlow: boolean;
};

export type EvolutionPoint = {
  /** Cierre del bucket, `YYYY-MM-DD`. */
  date: string;
  valueArs: number;
  valueUsd: number;
  /** Ganancia del período, neta de aportes y retiros. */
  changeArs: number;
  changeUsd: number;
  /** Rendimiento del tramo. `null` en el primer punto: no hay base. */
  returnPercent: number | null;
  netFlowArs: number;
  netFlowUsd: number;
  coverage: MonthCoverage;
  /** Tickers cuyo precio vino arrastrado de antes del período. */
  staleTickers: string[];
  gainers: EvolutionMover[];
  losers: EvolutionMover[];
};

export type PortfolioEvolution = {
  hasData: boolean;
  /**
   * Las tres granularidades vienen calculadas: el toggle de la UI no refetchea, igual
   * que el selector de período de `/rendimientos`.
   */
  series: Record<Granularity, EvolutionPoint[]>;
  firstDate: string | null;
  lastDate: string | null;
};

export const EMPTY_EVOLUTION: PortfolioEvolution = {
  hasData: false,
  series: { daily: [], weekly: [], monthly: [] },
  firstDate: null,
  lastDate: null,
};

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Redondeo de cierre. La resta de floats deja ruido (`-49222.99999999999`) que ensucia
 * el formateo y engorda el payload sin agregar precisión.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Capital neto por instrumento en `(previousClose, close]`.
 *
 * Se abre en el extremo izquierdo para no contar dos veces una operación que ya entró
 * en el cierre anterior. En el primer punto `previousClose` es `null`, así que entra
 * todo el capital histórico: `V_{t−1}` vale 0 y la ganancia queda contra el costo.
 */
function flowsInWindow(
  flows: InstrumentFlow[],
  previousClose: Date | null,
  close: Date
): Map<string, number> {
  const lowerBound = previousClose?.getTime() ?? Number.NEGATIVE_INFINITY;
  const upperBound = close.getTime();
  const byInstrument = new Map<string, number>();

  for (const flow of flows) {
    if (flow.time <= lowerBound || flow.time > upperBound) continue;
    byInstrument.set(flow.instrumentId, (byInstrument.get(flow.instrumentId) ?? 0) + flow.amountArs);
  }

  return byInstrument;
}

/** Índice por instrumento para cruzar dos cierres consecutivos. */
function indexPositions(positions: PositionDetail[]): Map<string, PositionDetail> {
  return new Map(positions.map((position) => [position.instrumentId, position]));
}

/**
 * Ganadores y perdedores del período, ordenados por magnitud de la ganancia.
 *
 * Recorre la unión de ambos cierres: una posición cerrada en el período no está en el
 * cierre actual pero su resultado sí es del período, y una abierta no está en el
 * anterior.
 */
function computeMovers(
  previous: PositionDetail[],
  current: PositionDetail[],
  flowsByInstrument: Map<string, number>,
  cclMid: number | null
): { gainers: EvolutionMover[]; losers: EvolutionMover[] } {
  const previousById = indexPositions(previous);
  const currentById = indexPositions(current);
  const instrumentIds = new Set([...previousById.keys(), ...currentById.keys()]);

  const movers: EvolutionMover[] = [];

  for (const instrumentId of instrumentIds) {
    const before = previousById.get(instrumentId);
    const after = currentById.get(instrumentId);
    const reference = after ?? before!;

    const valueBefore = before?.valueArs ?? 0;
    const valueAfter = after?.valueArs ?? 0;
    const netFlow = flowsByInstrument.get(instrumentId) ?? 0;
    const pnlArs = valueAfter - valueBefore - netFlow;

    // Sin precio anterior no hay variación: `null`, nunca 0. Un 0 diría "no se movió",
    // y lo que pasa es que no hay con qué comparar.
    const pricePercent =
      before && after && before.priceArs > 0
        ? (after.priceArs / before.priceArs - 1) * 100
        : null;

    movers.push({
      ticker: reference.ticker,
      pnlArs: round2(pnlArs),
      pnlUsd: cclMid && cclMid > 0 ? round2(pnlArs / cclMid) : 0,
      pricePercent: pricePercent === null ? null : round4(pricePercent),
      priceIsStale: after?.priceIsStale ?? true,
      hadFlow: netFlow !== 0,
    });
  }

  const gainers = movers
    .filter((mover) => mover.pnlArs > 0)
    .sort((a, b) => b.pnlArs - a.pnlArs)
    .slice(0, MOVERS_PER_SIDE);

  const losers = movers
    .filter((mover) => mover.pnlArs < 0)
    .sort((a, b) => a.pnlArs - b.pnlArs)
    .slice(0, MOVERS_PER_SIDE);

  return { gainers, losers };
}

/**
 * Cierres de bucket de la serie: las ruedas del rango, agrupadas.
 *
 * La serie termina en la última rueda con dato, no en "hoy". Si hoy no cerró todavía,
 * un punto de hoy repetiría el valor del último cierre: un escalón plano que sugiere
 * que el mercado no se movió cuando lo que pasa es que aún no hay dato.
 */
function closesFor(inputs: EvolutionInputs, granularity: Granularity): Date[] {
  const fromTime = inputs.from.getTime();
  const toTime = inputs.to.getTime();
  const inRange = inputs.tradingDays.filter(
    (day) => day.getTime() >= fromTime && day.getTime() <= toTime
  );

  if (inRange.length === 0) return bucketEndpoints(inputs.from, inputs.to, granularity);
  return bucketByLastDay(inRange, granularity);
}

function buildSeries(inputs: EvolutionInputs, granularity: Granularity): EvolutionPoint[] {
  const closes = closesFor(inputs, granularity);
  if (closes.length === 0) return [];

  const points: EvolutionPoint[] = [];
  let previousValuation: PortfolioValuation | null = null;
  let previousClose: Date | null = null;

  for (const close of closes) {
    // Un precio anterior al inicio del bucket es arrastre: sirve para valuar, pero no
    // es un precio "del período". `windowStart` es lo que permite distinguirlos.
    const windowStart = previousClose
      ? new Date(previousClose.getTime() + MS_PER_DAY)
      : closes[0]!;

    const valuation = valuatePortfolioAt(inputs, close, windowStart);
    const flowsByInstrument = flowsInWindow(inputs.flows, previousClose, close);

    let netFlowArs = 0;
    for (const amount of flowsByInstrument.values()) netFlowArs += amount;
    const netFlowUsd =
      valuation.cclMid && valuation.cclMid > 0 ? netFlowArs / valuation.cclMid : 0;

    const previousValueArs = previousValuation?.valueArs ?? 0;
    const previousValueUsd = previousValuation?.valueUsd ?? 0;

    const { gainers, losers } = previousValuation
      ? computeMovers(
          previousValuation.positions,
          valuation.positions,
          flowsByInstrument,
          valuation.cclMid
        )
      : { gainers: [], losers: [] };

    const returnPercent = previousValuation
      // Mismo TWR de un tramo que usa el motor mensual, ya testeado en `returns.ts`.
      ? subPeriodReturn(previousValueArs, valuation.valueArs, netFlowArs)
      : null;

    points.push({
      date: isoDay(close),
      valueArs: round2(valuation.valueArs),
      valueUsd: round2(valuation.valueUsd),
      changeArs: previousValuation
        ? round2(valuation.valueArs - previousValueArs - netFlowArs)
        : 0,
      changeUsd: previousValuation
        ? round2(valuation.valueUsd - previousValueUsd - netFlowUsd)
        : 0,
      returnPercent: returnPercent === null ? null : round4(returnPercent),
      netFlowArs: round2(netFlowArs),
      netFlowUsd: round2(netFlowUsd),
      coverage: valuation.coverage,
      staleTickers: valuation.staleTickers,
      gainers,
      losers,
    });

    previousValuation = valuation;
    previousClose = close;
  }

  return points;
}

export function buildEvolutionSeries(inputs: EvolutionInputs): PortfolioEvolution {
  if (inputs.trades.length === 0) return EMPTY_EVOLUTION;
  if (inputs.from.getTime() > inputs.to.getTime()) return EMPTY_EVOLUTION;

  const series: Record<Granularity, EvolutionPoint[]> = {
    daily: buildSeries(inputs, "daily"),
    weekly: buildSeries(inputs, "weekly"),
    monthly: buildSeries(inputs, "monthly"),
  };

  if (series.daily.length === 0) return EMPTY_EVOLUTION;

  return {
    hasData: true,
    series,
    firstDate: series.daily[0]!.date,
    lastDate: series.daily.at(-1)!.date,
  };
}

export type { Granularity, PriceIndex, TimeSeries };
