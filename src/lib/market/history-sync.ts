/**
 * Backfill de series históricas: llena las tablas que ya existen en el schema
 * (`PriceCache`, `FxRate`, `MacroSeries`) para que el motor de rendimientos pueda
 * reconstruir el histórico sin depender de snapshots diarios.
 *
 * Lo consumen los crons `/api/cron/backfill-prices` y `/api/cron/backfill-macro`.
 *
 * Tres invariantes que hacen que esto sea seguro de correr N veces:
 *
 * 1. **Idempotencia.** Todo entra por la clave única de su tabla. Se leen las
 *    fechas ya presentes y solo se insertan las nuevas (`createMany` +
 *    `skipDuplicates`), que es mucho más rápido que un upsert por fila cuando
 *    hay miles de puntos.
 * 2. **Ventana de revisión.** Los valores históricos no cambian, pero los últimos
 *    días sí pueden corregirse en la fuente. Las últimas `REVISION_WINDOW_DAYS`
 *    fechas se reescriben con upsert en vez de saltarse.
 * 3. **Reanudable.** Si una corrida se corta a la mitad, la siguiente completa lo
 *    que falta. Ningún paso depende de que el anterior haya terminado.
 */

import { Prisma, type InstrumentType, type MacroCode } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchCclHistory, fetchInflationHistory } from "./argentinadatos";
import { ARGENTINIAN_TYPES } from "./quotes";
import { buildYahooSymbol, fetchYahooHistory, type YahooSplitEvent } from "./yahoo";

/**
 * `source` de las filas EOD en `PriceCache`.
 *
 * Deliberadamente distinto de `"yahoo"`, que usa `refreshLatestQuotes` para
 * precios intradiarios con `datetime` arbitrario (el `asOf` del quote). Si el
 * backfill escribiera con el mismo `source`, la serie diaria quedaría contaminada
 * con filas intradiarias y cualquier query con `distinct` levantaría la fila
 * equivocada. Acá el `datetime` es siempre medianoche UTC.
 */
export const EOD_PRICE_SOURCE = "yahoo-eod";

/** Símbolos Yahoo de los índices que usamos como benchmark. */
export const INDEX_SYMBOLS = {
  MERVAL: "^MERV",
  SP500: "^GSPC",
} as const satisfies Partial<Record<MacroCode, string>>;

/** Días recientes que se reescriben en vez de saltarse, por si la fuente los corrigió. */
const REVISION_WINDOW_DAYS = 5;

/** Requests concurrentes contra Yahoo durante el backfill de precios. */
const PRICE_CONCURRENCY = 5;

export type SyncResult = {
  /** Puntos que la fuente devolvió dentro del rango pedido. */
  fetched: number;
  inserted: number;
  /** Puntos reescritos por caer en la ventana de revisión. */
  revised: number;
  errors: string[];
};

const EMPTY_RESULT: SyncResult = { fetched: 0, inserted: 0, revised: 0, errors: [] };

function emptyResult(error?: string): SyncResult {
  return { ...EMPTY_RESULT, errors: error ? [error] : [] };
}

/** Medianoche UTC de hoy. */
export function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function revisionCutoff(): number {
  return todayUtc().getTime() - REVISION_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

/** Corre `task` sobre `items` con concurrencia acotada, preservando el orden de salida. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ============================================================
// CCL histórico → FxRate
// ============================================================

/**
 * Puebla `FxRate` con el CCL diario desde `from`.
 *
 * Sin esta serie la vista en USD es imposible: para valuar un día pasado hace
 * falta el CCL *de ese día*, y `resolveCclRate()` solo conoce el de hoy.
 */
export async function syncCclHistory(opts: { from: Date }): Promise<SyncResult> {
  const history = await fetchCclHistory();
  if (!history) return emptyResult("argentinadatos CCL: sin respuesta");

  // FxRate tiene FK a Currency; sin esas filas cada insert explota.
  const currencies = await prisma.currency.findMany({
    where: { code: { in: ["USD", "ARS"] } },
    select: { code: true },
  });
  if (currencies.length < 2) {
    return emptyResult(
      "Faltan las monedas USD y/o ARS en la tabla Currency — correr `npm run db:seed` antes del backfill"
    );
  }

  const fromTime = opts.from.getTime();
  const points = history.filter((p) => p.date.getTime() >= fromTime);
  if (points.length === 0) return { ...EMPTY_RESULT, fetched: 0 };

  const existing = await prisma.fxRate.findMany({
    where: {
      baseCurrencyCode: "USD",
      quoteCurrencyCode: "ARS",
      source: "CCL",
      date: { gte: opts.from },
    },
    select: { date: true },
  });
  const existingTimes = new Set(existing.map((row) => row.date.getTime()));
  const cutoff = revisionCutoff();

  const toInsert = points.filter(
    (p) => !existingTimes.has(p.date.getTime()) && p.date.getTime() < cutoff
  );
  const toRevise = points.filter((p) => p.date.getTime() >= cutoff);

  const errors: string[] = [];
  let inserted = 0;

  if (toInsert.length > 0) {
    const created = await prisma.fxRate.createMany({
      data: toInsert.map((p) => ({
        date: p.date,
        baseCurrencyCode: "USD",
        quoteCurrencyCode: "ARS",
        source: "CCL" as const,
        buy: new Prisma.Decimal(p.buy),
        sell: new Prisma.Decimal(p.sell),
        mid: new Prisma.Decimal(p.mid),
      })),
      skipDuplicates: true,
    });
    inserted = created.count;
  }

  for (const p of toRevise) {
    try {
      await prisma.fxRate.upsert({
        where: {
          date_baseCurrencyCode_quoteCurrencyCode_source: {
            date: p.date,
            baseCurrencyCode: "USD",
            quoteCurrencyCode: "ARS",
            source: "CCL",
          },
        },
        create: {
          date: p.date,
          baseCurrencyCode: "USD",
          quoteCurrencyCode: "ARS",
          source: "CCL",
          buy: new Prisma.Decimal(p.buy),
          sell: new Prisma.Decimal(p.sell),
          mid: new Prisma.Decimal(p.mid),
        },
        update: {
          buy: new Prisma.Decimal(p.buy),
          sell: new Prisma.Decimal(p.sell),
          mid: new Prisma.Decimal(p.mid),
        },
      });
    } catch (err) {
      errors.push(`CCL ${p.date.toISOString().slice(0, 10)}: ${describeError(err)}`);
    }
  }

  return { fetched: points.length, inserted, revised: toRevise.length - errors.length, errors };
}

// ============================================================
// Inflación → MacroSeries(IPC_AR)
// ============================================================

/**
 * Puebla `MacroSeries` con la inflación mensual del INDEC.
 *
 * El `value` guardado es la **variación porcentual mensual** (1.9 = 1,9 %), no un
 * nivel de índice. Ver `InflationPoint.monthlyPercent`.
 */
export async function syncInflationHistory(): Promise<SyncResult> {
  const history = await fetchInflationHistory();
  if (!history) return emptyResult("argentinadatos inflación: sin respuesta");

  return upsertMacroPoints(
    "IPC_AR",
    history.map((p) => ({ date: p.date, value: p.monthlyPercent })),
    // El INDEC revisa con más lag que un mercado: 2 meses de ventana.
    todayUtc().getTime() - 62 * 24 * 60 * 60 * 1000
  );
}

// ============================================================
// Índices → MacroSeries(MERVAL | SP500)
// ============================================================

/**
 * Puebla `MacroSeries` con el cierre diario de un índice.
 *
 * El `value` guardado es el **nivel** del índice, no una variación. El motor de
 * benchmarks lo encadena a variaciones mensuales.
 */
export async function syncIndexHistory(
  code: keyof typeof INDEX_SYMBOLS,
  opts: { from: Date }
): Promise<SyncResult> {
  const symbol = INDEX_SYMBOLS[code];
  try {
    const { bars } = await fetchYahooHistory(symbol, { from: opts.from, to: new Date() });
    return upsertMacroPoints(
      code,
      bars.map((bar) => ({ date: bar.date, value: bar.close })),
      revisionCutoff()
    );
  } catch (err) {
    return emptyResult(`${symbol}: ${describeError(err)}`);
  }
}

/** Inserta puntos nuevos en bloque y reescribe los que caen después de `cutoff`. */
async function upsertMacroPoints(
  code: MacroCode,
  points: Array<{ date: Date; value: number }>,
  cutoff: number
): Promise<SyncResult> {
  if (points.length === 0) return { ...EMPTY_RESULT };

  const earliest = points.reduce(
    (min, p) => (p.date.getTime() < min.getTime() ? p.date : min),
    points[0]!.date
  );

  const existing = await prisma.macroSeries.findMany({
    where: { code, date: { gte: earliest } },
    select: { date: true },
  });
  const existingTimes = new Set(existing.map((row) => row.date.getTime()));

  const toInsert = points.filter(
    (p) => !existingTimes.has(p.date.getTime()) && p.date.getTime() < cutoff
  );
  const toRevise = points.filter((p) => p.date.getTime() >= cutoff);

  const errors: string[] = [];
  let inserted = 0;

  if (toInsert.length > 0) {
    const created = await prisma.macroSeries.createMany({
      data: toInsert.map((p) => ({
        code,
        date: p.date,
        value: new Prisma.Decimal(p.value),
      })),
      skipDuplicates: true,
    });
    inserted = created.count;
  }

  for (const p of toRevise) {
    try {
      await prisma.macroSeries.upsert({
        where: { code_date: { code, date: p.date } },
        create: { code, date: p.date, value: new Prisma.Decimal(p.value) },
        update: { value: new Prisma.Decimal(p.value) },
      });
    } catch (err) {
      errors.push(`${code} ${p.date.toISOString().slice(0, 10)}: ${describeError(err)}`);
    }
  }

  return { fetched: points.length, inserted, revised: toRevise.length - errors.length, errors };
}

// ============================================================
// Precios EOD por instrumento → PriceCache
// ============================================================

export type InstrumentForHistory = {
  id: string;
  ticker: string;
  type: InstrumentType;
};

export type PriceSyncResult = SyncResult & {
  instruments: number;
  /** Splits que Yahoo reporta y no están en `CorporateEvent` — hay que revisarlos a mano. */
  unregisteredSplits: Array<{ ticker: string; date: string; ratio: string }>;
};

/**
 * Trae la serie EOD de cada instrumento y la guarda en `PriceCache`.
 *
 * Un request por instrumento (el rango completo viene en una sola respuesta), con
 * concurrencia acotada para no hacerle daño a Yahoo. Falla por instrumento sin
 * abortar el resto: un ticker sin cobertura no puede impedir que se backfilleen
 * los otros veinte.
 *
 * También compara los splits que reporta Yahoo contra `CorporateEvent` y devuelve
 * los que faltan. **No los inserta**: un split mal cargado corrompe todo el
 * histórico de ese ticker, así que la decisión queda en manos de una persona.
 */
export async function syncPriceHistory(
  instruments: InstrumentForHistory[],
  opts: { from: Date }
): Promise<PriceSyncResult> {
  const base: PriceSyncResult = {
    ...EMPTY_RESULT,
    errors: [],
    instruments: instruments.length,
    unregisteredSplits: [],
  };
  if (instruments.length === 0) return base;

  const registeredEvents = await prisma.corporateEvent.findMany({
    where: { instrumentId: { in: instruments.map((i) => i.id) } },
    select: { instrumentId: true, effectiveDate: true },
  });
  const registeredByInstrument = new Map<string, Set<number>>();
  for (const event of registeredEvents) {
    const day = Date.UTC(
      event.effectiveDate.getUTCFullYear(),
      event.effectiveDate.getUTCMonth(),
      event.effectiveDate.getUTCDate()
    );
    const set = registeredByInstrument.get(event.instrumentId) ?? new Set<number>();
    set.add(day);
    registeredByInstrument.set(event.instrumentId, set);
  }

  const perInstrument = await mapWithConcurrency(
    instruments,
    PRICE_CONCURRENCY,
    async (instrument) => {
      const symbol = buildYahooSymbol(instrument.ticker, ARGENTINIAN_TYPES.has(instrument.type));
      try {
        const { bars, splits } = await fetchYahooHistory(symbol, {
          from: opts.from,
          to: new Date(),
        });
        // Yahoo **reescribe retroactivamente** toda la serie cuando hay un split o
        // un cambio de ratio de CEDEAR: verificado en SPY.BA, donde el 01/06/2026
        // pasó de 20:1 a 60:1 y los cierres anteriores quedaron divididos por 3, sin
        // salto en la curva. Con la ventana de revisión normal solo se reescribirían
        // los últimos días y todo el histórico anterior quedaría con los precios
        // viejos para siempre — valuando las posiciones 3× de más contra cantidades
        // ya ajustadas por `CorporateEvent`. Ante un split se reescribe la serie entera.
        const written = await writePriceBars(instrument.id, bars, splits.length > 0);
        return {
          ...written,
          unregisteredSplits: findUnregisteredSplits(
            instrument.ticker,
            splits,
            registeredByInstrument.get(instrument.id)
          ),
        };
      } catch (err) {
        return {
          fetched: 0,
          inserted: 0,
          revised: 0,
          errors: [`${symbol}: ${describeError(err)}`],
          unregisteredSplits: [],
        };
      }
    }
  );

  for (const result of perInstrument) {
    base.fetched += result.fetched;
    base.inserted += result.inserted;
    base.revised += result.revised;
    base.errors.push(...result.errors);
    base.unregisteredSplits.push(...result.unregisteredSplits);
  }

  return base;
}

async function writePriceBars(
  instrumentId: string,
  bars: Array<{
    date: Date;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number;
    volume: number | null;
  }>,
  /** Reescribe la serie completa en vez de solo la ventana de revisión. */
  rewriteAll = false
): Promise<SyncResult> {
  if (bars.length === 0) return { ...EMPTY_RESULT };

  const earliest = bars[0]!.date;
  const existing = await prisma.priceCache.findMany({
    where: { instrumentId, source: EOD_PRICE_SOURCE, datetime: { gte: earliest } },
    select: { datetime: true },
  });
  const existingTimes = new Set(existing.map((row) => row.datetime.getTime()));
  const cutoff = rewriteAll ? Number.NEGATIVE_INFINITY : revisionCutoff();

  const toInsert = bars.filter(
    (bar) => !existingTimes.has(bar.date.getTime()) && bar.date.getTime() < cutoff
  );
  const toRevise = bars.filter((bar) => bar.date.getTime() >= cutoff);

  const decimalOrNull = (value: number | null) =>
    value === null ? null : new Prisma.Decimal(value);

  const errors: string[] = [];
  let inserted = 0;

  if (toInsert.length > 0) {
    const created = await prisma.priceCache.createMany({
      data: toInsert.map((bar) => ({
        instrumentId,
        datetime: bar.date,
        open: decimalOrNull(bar.open),
        high: decimalOrNull(bar.high),
        low: decimalOrNull(bar.low),
        close: new Prisma.Decimal(bar.close),
        volume: decimalOrNull(bar.volume),
        source: EOD_PRICE_SOURCE,
      })),
      skipDuplicates: true,
    });
    inserted = created.count;
  }

  for (const bar of toRevise) {
    try {
      await prisma.priceCache.upsert({
        where: {
          instrumentId_datetime_source: {
            instrumentId,
            datetime: bar.date,
            source: EOD_PRICE_SOURCE,
          },
        },
        create: {
          instrumentId,
          datetime: bar.date,
          open: decimalOrNull(bar.open),
          high: decimalOrNull(bar.high),
          low: decimalOrNull(bar.low),
          close: new Prisma.Decimal(bar.close),
          volume: decimalOrNull(bar.volume),
          source: EOD_PRICE_SOURCE,
        },
        update: {
          open: decimalOrNull(bar.open),
          high: decimalOrNull(bar.high),
          low: decimalOrNull(bar.low),
          close: new Prisma.Decimal(bar.close),
          volume: decimalOrNull(bar.volume),
        },
      });
    } catch (err) {
      errors.push(`${bar.date.toISOString().slice(0, 10)}: ${describeError(err)}`);
    }
  }

  return { fetched: bars.length, inserted, revised: toRevise.length - errors.length, errors };
}

function findUnregisteredSplits(
  ticker: string,
  splits: YahooSplitEvent[],
  registeredDays: Set<number> | undefined
): Array<{ ticker: string; date: string; ratio: string }> {
  return splits
    .filter((split) => !registeredDays?.has(split.date.getTime()))
    .map((split) => ({
      ticker,
      date: split.date.toISOString().slice(0, 10),
      ratio: `${split.numerator}:${split.denominator}`,
    }));
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
