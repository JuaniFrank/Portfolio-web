/**
 * Orquestación de los dos backfills de histórico (macro y precios por instrumento).
 *
 * Extraído de los cron routes para poder dispararlos también en caliente, justo
 * después de un import de movimientos, sin esperar a la corrida nocturna. Ambas
 * funciones recalculan su rango contra el `Transaction` actual en cada llamada
 * (primera operación por instrumento / por toda la base), así que no hace falta
 * un chequeo de cobertura aparte: correrlas de nuevo ya cubre lo que falte.
 */

import { prisma } from "@/lib/prisma";
import { PERFORMANCE_INSTRUMENT_TYPES } from "@/lib/rendimientos/types";
import {
  syncCclHistory,
  syncIndexHistory,
  syncInflationHistory,
  syncPriceHistory,
  type InstrumentForHistory,
  type SyncResult,
} from "./history-sync";

/** Colchón sobre la primera transacción: los benchmarks necesitan el mes anterior. */
const MACRO_LOOKBACK_DAYS = 45;

/** Colchón hacia atrás: la valuación del primer mes puede necesitar precios previos. */
const PRICE_LOOKBACK_DAYS = 10;

export type MacroBackfillResult =
  | { ok: true; skipped: string }
  | {
      ok: boolean;
      from: string;
      ccl: SyncResult;
      inflation: SyncResult;
      merval: SyncResult;
      sp500: SyncResult;
      errors: string[];
    };

/** El rango arranca en la primera transacción registrada en toda la base. */
export async function runMacroBackfill(): Promise<MacroBackfillResult> {
  const earliest = await prisma.transaction.findFirst({
    orderBy: { tradeDate: "asc" },
    select: { tradeDate: true },
  });

  if (!earliest) {
    return { ok: true, skipped: "sin transacciones registradas" };
  }

  const from = new Date(earliest.tradeDate.getTime() - MACRO_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // Secuencial a propósito: son cuatro proveedores distintos y preferimos ser
  // amables con ellos antes que ganar unos segundos.
  const ccl = await syncCclHistory({ from });
  const inflation = await syncInflationHistory();
  const merval = await syncIndexHistory("MERVAL", { from });
  const sp500 = await syncIndexHistory("SP500", { from });

  const errors = [...ccl.errors, ...inflation.errors, ...merval.errors, ...sp500.errors];

  return {
    ok: errors.length === 0,
    from: from.toISOString().slice(0, 10),
    ccl,
    inflation,
    merval,
    sp500,
    errors,
  };
}

export type PriceBackfillResult =
  | { ok: true; skipped: string }
  | {
      ok: boolean;
      instruments: number;
      fetched: number;
      inserted: number;
      revised: number;
      unregisteredSplits: Array<{ ticker: string; date: string; ratio: string }>;
      errors: string[];
    };

/**
 * Solo trae los instrumentos que alguien tiene o tuvo en cartera y cuyo tipo
 * entra en el motor de rendimientos, cada uno desde su propia primera operación.
 */
export async function runPriceBackfill(): Promise<PriceBackfillResult> {
  // Una fila por instrumento operado, con la fecha de su primera operación.
  const firstTrades = await prisma.transaction.groupBy({
    by: ["instrumentId"],
    where: {
      type: { in: ["BUY", "SELL"] },
      instrument: { type: { in: PERFORMANCE_INSTRUMENT_TYPES } },
    },
    _min: { tradeDate: true },
  });

  const instrumentIds = firstTrades
    .map((row) => row.instrumentId)
    .filter((id): id is string => id !== null);

  if (instrumentIds.length === 0) {
    return { ok: true, skipped: "sin instrumentos elegibles en cartera" };
  }

  const instruments = await prisma.instrument.findMany({
    where: { id: { in: instrumentIds } },
    select: { id: true, ticker: true, type: true },
  });

  const firstTradeById = new Map(firstTrades.map((row) => [row.instrumentId, row._min.tradeDate]));

  // Se agrupan por fecha de arranque para no pedirle a Yahoo más rango del
  // necesario ni hacer un request por instrumento con el rango global.
  const byFrom = new Map<number, InstrumentForHistory[]>();
  for (const instrument of instruments) {
    const firstTrade = firstTradeById.get(instrument.id);
    if (!firstTrade) continue;
    const from = new Date(firstTrade.getTime() - PRICE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const key = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
    const list = byFrom.get(key) ?? [];
    list.push(instrument);
    byFrom.set(key, list);
  }

  let fetched = 0;
  let inserted = 0;
  let revised = 0;
  const errors: string[] = [];
  const unregisteredSplits: Array<{ ticker: string; date: string; ratio: string }> = [];

  for (const [fromTime, group] of byFrom) {
    const result = await syncPriceHistory(group, { from: new Date(fromTime) });
    fetched += result.fetched;
    inserted += result.inserted;
    revised += result.revised;
    errors.push(...result.errors);
    unregisteredSplits.push(...result.unregisteredSplits);
  }

  if (unregisteredSplits.length > 0) {
    // syncPriceHistory ya los guardó como SuggestedCorporateEvent (ver
    // persistUnregisteredSplits en history-sync.ts) — quedan visibles en /eventos
    // para que el usuario decida si aplicarlos. Acá solo quedan en el log.
    console.warn("Splits reportados por Yahoo sin registrar en CorporateEvent", unregisteredSplits);
  }

  return {
    ok: errors.length === 0,
    instruments: instruments.length,
    fetched,
    inserted,
    revised,
    unregisteredSplits,
    errors,
  };
}
