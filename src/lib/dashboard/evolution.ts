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
 * El perímetro es el de `/rendimientos` (`PERFORMANCE_INSTRUMENT_TYPES`) más ONs — este
 * loader ensancha el perímetro localmente (ver `EVOLUTION_INSTRUMENT_TYPES` en
 * `evolution-data.ts`); `/rendimientos` no se toca. El resto de renta fija y las letras
 * no tienen serie de precios, así que quedan afuera y se avisan.
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
  type DatedAmount,
  type PortfolioValuation,
  type ReplayInputs,
  sumUpTo,
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
  /**
   * El mismo capital en dólares, al CCL **del día de la operación**.
   *
   * Es lo que permite que la ganancia en dólares del tramo sea una medición y no la
   * ganancia en pesos dividida por el CCL del cierre: esa cuenta cancela el tipo de
   * cambio y devuelve el mismo porcentaje en las dos monedas.
   *
   * `null` cuando no hay CCL para esa fecha; ahí se cae al CCL del cierre, que es
   * aproximado pero no deja el tramo sin número.
   */
  amountUsd: number | null;
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
  /** Instrumentos elegibles que participaron: pasa directo a `PortfolioEvolution.instruments`. */
  instruments: EvolutionInstrument[];
  /**
   * Renta en ARS por fecha, ascendente, agrupada por instrumento (mismo formato que
   * `incomeArsByDate`, ver `accumulateInArs`). Permite atribuir la renta acumulada
   * (`valuatePortfolioAt` la suma solo al agregado) a la posición que la generó.
   * Opcional: sin ella, `incomeArs` queda en 0 en todas las posiciones — no rompe nada,
   * solo dice "no hay de dónde atribuir".
   */
  incomeArsByInstrument?: Map<string, DatedAmount[]>;
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
  /** El precio del cierre es el punto en vivo del día, no un cierre medido. */
  priceIsLive: boolean;
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

/** Detalle de una posición en un punto de la serie: solo lo que hace falta para el
 * filtro por ticker y el footnote de precios estimados de la UI. */
export type EvolutionPositionBreakdown = {
  ticker: string;
  valueArs: number;
  valueUsd: number;
  netFlowArs: number;
  netFlowUsd: number;
  /**
   * Renta acumulada (dividendos, cupones, amortizaciones de ON) del instrumento hasta el
   * cierre de este punto — el mismo `accumulatedIncomeArs` que `valuatePortfolioAt` suma
   * al agregado, pero atribuido al instrumento que la generó. `incomeUsd` sale de
   * dividir por el `cclMid` del punto, igual que `valueUsd`; 0 sin CCL.
   *
   * No es un flujo: es renta generada por la posición, así que el TWR la mide como
   * retorno (ver `buildViewRows` en `evolution-view.ts`).
   */
  incomeArs: number;
  incomeUsd: number;
  /** `true` cuando el precio de este cierre es el valor técnico estimado de una ON
   * sin cotización ese día (ver `@/lib/dashboard/bond-price-series`). */
  priceEstimated: boolean;
};

export type EvolutionPoint = {
  /** Cierre del bucket, `YYYY-MM-DD`. */
  date: string;
  valueArs: number;
  valueUsd: number;
  /** Ganancia del período, neta de aportes y retiros. */
  changeArs: number;
  changeUsd: number;
  /** Rendimiento del tramo en pesos. `null` en el primer punto: no hay base. */
  returnPercent: number | null;
  /**
   * Rendimiento del tramo medido en dólares. `null` sin base o sin CCL.
   *
   * No es `returnPercent` convertido: es el mismo TWR calculado sobre la serie en
   * dólares. Cuando el CCL se mueve, los dos números difieren — y esa diferencia es
   * exactamente lo que se quiere ver.
   */
  returnPercentUsd: number | null;
  netFlowArs: number;
  netFlowUsd: number;
  /** Suma acumulada de `netFlowArs`/`netFlowUsd` desde el primer punto de la serie. */
  cumulativeNetFlowArs: number;
  cumulativeNetFlowUsd: number;
  coverage: MonthCoverage;
  /** Tickers cuyo precio vino arrastrado de antes del período. */
  staleTickers: string[];
  gainers: EvolutionMover[];
  losers: EvolutionMover[];
  /** Detalle por posición: solo tickers con valor, movimiento o renta en este punto. */
  positions: EvolutionPositionBreakdown[];
  /** `true` cuando alguna posición de este punto usó un precio estimado (ver `positions`). */
  hasEstimatedPrices: boolean;
  /**
   * `valueArs`/`valueUsd` del agregado menos la suma de `positions` (`value + income`).
   * Cubre renta sin `instrumentId` y ruido de redondeo — en la práctica, ~0. Ver
   * `buildViewRows`: se suma a la selección solo cuando cubre todos los `instruments`.
   */
  unattributedIncomeArs: number;
  unattributedIncomeUsd: number;
};

/** Instrumento elegible que participó de la serie, para poblar filtros de la UI. */
export type EvolutionInstrument = {
  ticker: string;
  name: string;
  type: "STOCK_AR" | "CEDEAR" | "ON";
};

/** Marca de compra/venta para el chart, una fila por operación. */
export type EvolutionTrade = {
  /** Fecha de la operación, `YYYY-MM-DD`. */
  date: string;
  ticker: string;
  side: "buy" | "sell";
  quantity: number;
  amountArs: number;
  amountUsd: number;
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
  instruments: EvolutionInstrument[];
  trades: EvolutionTrade[];
};

export const EMPTY_EVOLUTION: PortfolioEvolution = {
  hasData: false,
  series: { daily: [], weekly: [], monthly: [] },
  firstDate: null,
  lastDate: null,
  instruments: [],
  trades: [],
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

/** Capital neto de un instrumento en el período, en las dos monedas. */
type WindowFlow = { ars: number; usd: number };

/**
 * Capital neto por instrumento en `(previousClose, close]`.
 *
 * Se abre en el extremo izquierdo para no contar dos veces una operación que ya entró
 * en el cierre anterior. En el primer punto `previousClose` es `null`, así que entra
 * todo el capital histórico: `V_{t−1}` vale 0 y la ganancia queda contra el costo.
 *
 * Cada operación aporta su importe en dólares al CCL de su propia fecha. `cclAtClose`
 * solo entra como respaldo para las que no lo traen.
 */
function flowsInWindow(
  flows: InstrumentFlow[],
  previousClose: Date | null,
  close: Date,
  cclAtClose: number | null
): Map<string, WindowFlow> {
  const lowerBound = previousClose?.getTime() ?? Number.NEGATIVE_INFINITY;
  const upperBound = close.getTime();
  const byInstrument = new Map<string, WindowFlow>();

  for (const flow of flows) {
    if (flow.time <= lowerBound || flow.time > upperBound) continue;
    const usd =
      flow.amountUsd ??
      (cclAtClose && cclAtClose > 0 ? flow.amountArs / cclAtClose : 0);
    const previous = byInstrument.get(flow.instrumentId) ?? { ars: 0, usd: 0 };
    byInstrument.set(flow.instrumentId, {
      ars: previous.ars + flow.amountArs,
      usd: previous.usd + usd,
    });
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
  flowsByInstrument: Map<string, WindowFlow>
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
    const netFlow = flowsByInstrument.get(instrumentId) ?? { ars: 0, usd: 0 };
    const pnlArs = valueAfter - valueBefore - netFlow.ars;

    // La misma identidad, pero armada con valores en dólares de cada cierre y con el
    // aporte convertido al CCL del día en que se hizo. Dividir `pnlArs` por el CCL del
    // cierre daría la ganancia en pesos re-etiquetada, no la ganancia en dólares.
    const pnlUsd = (after?.valueUsd ?? 0) - (before?.valueUsd ?? 0) - netFlow.usd;

    // Sin precio anterior no hay variación: `null`, nunca 0. Un 0 diría "no se movió",
    // y lo que pasa es que no hay con qué comparar.
    const pricePercent =
      before && after && before.priceArs > 0
        ? (after.priceArs / before.priceArs - 1) * 100
        : null;

    movers.push({
      ticker: reference.ticker,
      pnlArs: round2(pnlArs),
      pnlUsd: round2(pnlUsd),
      pricePercent: pricePercent === null ? null : round4(pricePercent),
      priceIsStale: after?.priceIsStale ?? true,
      priceIsLive: after?.priceIsLive ?? false,
      hadFlow: netFlow.ars !== 0,
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
 * Detalle por posición de un punto: valor a este cierre + movimiento neto en la
 * ventana, en las dos monedas.
 *
 * Recorre la unión de tres fuentes — posiciones del cierre actual, del anterior (para
 * el ticker de una posición cerrada dentro de la ventana) y de los flujos de la
 * ventana — porque una posición puede tener movimiento sin tener valor al cierre (se
 * vendió toda) o viceversa. `tickerById` es el último recurso: cubre el caso borde de
 * una posición que se abrió y cerró *dentro* de la misma ventana, así que nunca
 * aparece ni en el cierre anterior ni en el actual.
 */
function buildPositionBreakdown(
  previous: PositionDetail[],
  current: PositionDetail[],
  flowsByInstrument: Map<string, WindowFlow>,
  tickerById: Map<string, string>,
  incomeArsByInstrument: Map<string, DatedAmount[]>,
  cutoff: number,
  cclMid: number | null
): EvolutionPositionBreakdown[] {
  const previousById = indexPositions(previous);
  const currentById = indexPositions(current);
  const instrumentIds = new Set([
    ...previousById.keys(),
    ...currentById.keys(),
    ...flowsByInstrument.keys(),
    // Una posición cerrada puede seguir cobrando renta (un cupón después de vender
    // todo): sin esto, su ticker no entraría nunca más a `positions`.
    ...incomeArsByInstrument.keys(),
  ]);

  const positions: EvolutionPositionBreakdown[] = [];

  for (const instrumentId of instrumentIds) {
    const after = currentById.get(instrumentId);
    const before = previousById.get(instrumentId);
    const flow = flowsByInstrument.get(instrumentId);

    const valueArs = after?.valueArs ?? 0;
    const valueUsd = after?.valueUsd ?? 0;
    const netFlowArs = flow?.ars ?? 0;
    const netFlowUsd = flow?.usd ?? 0;

    // Mismo `sumUpTo` que usa `valuatePortfolioAt` para el agregado, con el cutoff del
    // mismo cierre: es la renta acumulada de ESTE instrumento, no la del período.
    const incomeArsDecimal = sumUpTo(incomeArsByInstrument.get(instrumentId) ?? [], cutoff);
    const incomeArs = incomeArsDecimal.toNumber();
    const incomeUsd = cclMid && cclMid > 0 ? incomeArs / cclMid : 0;

    // Solo tickers con algo que mostrar en este punto: valor a este cierre, movimiento
    // en la ventana, o renta acumulada. Sin ninguno de los tres no aporta nada al filtro.
    if (valueArs === 0 && valueUsd === 0 && netFlowArs === 0 && netFlowUsd === 0 && incomeArs === 0) {
      continue;
    }

    const ticker = after?.ticker ?? before?.ticker ?? tickerById.get(instrumentId) ?? instrumentId;

    positions.push({
      ticker,
      valueArs: round2(valueArs),
      valueUsd: round2(valueUsd),
      netFlowArs: round2(netFlowArs),
      netFlowUsd: round2(netFlowUsd),
      incomeArs: round2(incomeArs),
      incomeUsd: round2(incomeUsd),
      priceEstimated: after?.priceEstimated ?? false,
    });
  }

  return positions;
}

/**
 * Una marca por operación BUY/SELL, para los trade markers del chart.
 *
 * `amountArs` sale directo de `netAmount` (ya convertido a ARS por el loader para
 * operaciones en dólares, ver `evolution-data.ts`). `amountUsd` se deriva del CCL del
 * día de la operación — mismo criterio que el resto del motor: sin CCL para esa fecha,
 * 0 en vez de `null`, porque el tipo de esta fila no admite ausencia.
 */
function buildTradeMarkers(trades: ReplayInputs["trades"], ccl: TimeSeries): EvolutionTrade[] {
  return trades.map((trade) => {
    const tradeDate = new Date(trade.tradeDate);
    const amountArs = Math.abs(Number(trade.netAmount));
    const rate = ccl.asOf(tradeDate)?.value ?? null;
    return {
      date: isoDay(tradeDate),
      ticker: trade.ticker,
      side: trade.type === "BUY" ? "buy" : "sell",
      quantity: Number(trade.quantity),
      amountArs,
      amountUsd: rate && rate > 0 ? amountArs / rate : 0,
    };
  });
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

  // Último recurso de `buildPositionBreakdown` para una posición abierta y cerrada
  // dentro de una misma ventana: no aparece en ningún cierre, así que el ticker sale
  // de acá en vez de las posiciones valuadas.
  const tickerById = new Map(inputs.trades.map((trade) => [trade.instrumentId, trade.ticker]));
  const incomeArsByInstrument = inputs.incomeArsByInstrument ?? new Map<string, DatedAmount[]>();

  const points: EvolutionPoint[] = [];
  let previousValuation: PortfolioValuation | null = null;
  let previousClose: Date | null = null;
  let cumulativeNetFlowArs = 0;
  let cumulativeNetFlowUsd = 0;

  for (const close of closes) {
    // Un precio anterior al inicio del bucket es arrastre: sirve para valuar, pero no
    // es un precio "del período". `windowStart` es lo que permite distinguirlos.
    const windowStart = previousClose
      ? new Date(previousClose.getTime() + MS_PER_DAY)
      : closes[0]!;

    const valuation = valuatePortfolioAt(inputs, close, windowStart);
    const flowsByInstrument = flowsInWindow(
      inputs.flows,
      previousClose,
      close,
      valuation.cclMid
    );

    let netFlowArs = 0;
    let netFlowUsd = 0;
    for (const amount of flowsByInstrument.values()) {
      netFlowArs += amount.ars;
      netFlowUsd += amount.usd;
    }

    const previousValueArs = previousValuation?.valueArs ?? 0;
    const previousValueUsd = previousValuation?.valueUsd ?? 0;

    const { gainers, losers } = previousValuation
      ? computeMovers(previousValuation.positions, valuation.positions, flowsByInstrument)
      : { gainers: [], losers: [] };

    const returnPercent = previousValuation
      // Mismo TWR de un tramo que usa el motor mensual, ya testeado en `returns.ts`.
      ? subPeriodReturn(previousValueArs, valuation.valueArs, netFlowArs)
      : null;

    // El mismo TWR sobre la serie en dólares. Sin CCL en alguno de los dos extremos no
    // hay tramo que medir: `null`, no 0.
    const returnPercentUsd =
      previousValuation && valuation.cclMid && previousValuation.cclMid
        ? subPeriodReturn(previousValueUsd, valuation.valueUsd, netFlowUsd)
        : null;

    const cutoff = close.getTime();
    const positions = buildPositionBreakdown(
      previousValuation?.positions ?? [],
      valuation.positions,
      flowsByInstrument,
      tickerById,
      incomeArsByInstrument,
      cutoff,
      valuation.cclMid
    );

    // Lo que no quedó explicado por ninguna posición: renta sin `instrumentId` y ruido
    // de redondeo. En la práctica, ~0 — ver el test de reconciliación.
    const attributedValueArs = positions.reduce((sum, p) => sum + p.valueArs + p.incomeArs, 0);
    const attributedValueUsd = positions.reduce((sum, p) => sum + p.valueUsd + p.incomeUsd, 0);
    const unattributedIncomeArs = round2(valuation.valueArs - attributedValueArs);
    const unattributedIncomeUsd = round2(valuation.valueUsd - attributedValueUsd);

    cumulativeNetFlowArs += netFlowArs;
    cumulativeNetFlowUsd += netFlowUsd;

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
      returnPercentUsd: returnPercentUsd === null ? null : round4(returnPercentUsd),
      netFlowArs: round2(netFlowArs),
      netFlowUsd: round2(netFlowUsd),
      cumulativeNetFlowArs: round2(cumulativeNetFlowArs),
      cumulativeNetFlowUsd: round2(cumulativeNetFlowUsd),
      coverage: valuation.coverage,
      staleTickers: valuation.staleTickers,
      gainers,
      losers,
      positions,
      hasEstimatedPrices: positions.some((position) => position.priceEstimated),
      unattributedIncomeArs,
      unattributedIncomeUsd,
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
    instruments: inputs.instruments,
    trades: buildTradeMarkers(inputs.trades, inputs.ccl),
  };
}

export type { Granularity, PriceIndex, TimeSeries };
