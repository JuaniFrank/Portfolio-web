/**
 * Backfill de precios EOD por instrumento → `PriceCache` (source `yahoo-eod`).
 *
 * Solo trae los instrumentos que **alguien tiene o tuvo en cartera** y cuyo tipo
 * entra en el motor de rendimientos: no tiene sentido bajar diez años de un ticker
 * que nadie operó. Y para cada uno arranca en **su propia primera operación**, que
 * es el histórico que le corresponde a ese instrumento.
 *
 * Corre después de `backfill-macro`. Declarado en `vercel.json`.
 *
 * Prueba local: `curl -X POST http://localhost:3000/api/cron/backfill-prices`
 */

import { verifyCronSecret } from "@/lib/cron/auth";
import { syncPriceHistory, type InstrumentForHistory } from "@/lib/market/history-sync";
import { prisma } from "@/lib/prisma";
import { PERFORMANCE_INSTRUMENT_TYPES } from "@/lib/rendimientos/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Colchón hacia atrás: la valuación del primer mes puede necesitar precios previos. */
const LOOKBACK_DAYS = 10;

async function run(): Promise<Response> {
  try {
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
      return Response.json({ ok: true, skipped: "sin instrumentos elegibles en cartera" });
    }

    const instruments = await prisma.instrument.findMany({
      where: { id: { in: instrumentIds } },
      select: { id: true, ticker: true, type: true },
    });

    const firstTradeById = new Map(
      firstTrades.map((row) => [row.instrumentId, row._min.tradeDate])
    );

    // Se agrupan por fecha de arranque para no pedirle a Yahoo más rango del necesario
    // ni hacer un request por instrumento con el rango global.
    const byFrom = new Map<number, InstrumentForHistory[]>();
    for (const instrument of instruments) {
      const firstTrade = firstTradeById.get(instrument.id);
      if (!firstTrade) continue;
      const from = new Date(firstTrade.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
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
      // No los insertamos: un split mal cargado corrompe todo el histórico de ese
      // ticker. Queda visible en el log y en la respuesta para revisarlo a mano.
      console.warn("Splits reportados por Yahoo sin registrar en CorporateEvent", unregisteredSplits);
    }

    return Response.json(
      {
        ok: errors.length === 0,
        instruments: instruments.length,
        fetched,
        inserted,
        revised,
        unregisteredSplits,
        errors,
      },
      { status: errors.length === 0 ? 200 : 207 }
    );
  } catch (error) {
    console.error("Backfill prices cron error", error);
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return verifyCronSecret(request) ?? run();
}

export async function POST(request: Request) {
  return verifyCronSecret(request) ?? run();
}
