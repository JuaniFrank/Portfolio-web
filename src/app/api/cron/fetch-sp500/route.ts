/**
 * Backfill del S&P 500 → `MacroSeries(SP500)`.
 *
 * **Este endpoint estaba roto.** Usaba `v7/finance/download`, que Yahoo dio de baja:
 * hoy responde `401 {"code":"unauthorized","description":"User is not logged in"}`, así
 * que la tabla `Sp500Snapshot` no se actualizaba desde entonces y la comparación contra
 * el benchmark quedó congelada sin que nada avisara. Ahora delega en el cliente `v8/chart`
 * compartido, el mismo que usa el resto del market data.
 *
 * El destino también cambió: `MacroSeries(SP500)` en vez de `Sp500Snapshot`. `MacroSeries`
 * ya existía en el schema con la clave `[code, date]` y sirve para los tres benchmarks
 * (IPC_AR, MERVAL, SP500), así que `Sp500Snapshot` queda redundante — se puede eliminar
 * en una migración futura, cuando se confirme que nada la lee.
 *
 * Queda como endpoint aparte para poder resincronizar solo el S&P sin correr todo el
 * backfill macro; `/api/cron/backfill-macro` ya lo incluye en su corrida diaria.
 *
 * Prueba local: `curl -X POST http://localhost:3000/api/cron/fetch-sp500`
 */

import { verifyCronSecret } from "@/lib/cron/auth";
import { syncIndexHistory } from "@/lib/market/history-sync";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DEFAULT_YEARS_BACK = 10;

async function run(): Promise<Response> {
  try {
    const earliest = await prisma.transaction.findFirst({
      orderBy: { tradeDate: "asc" },
      select: { tradeDate: true },
    });

    const fallback = new Date();
    fallback.setUTCFullYear(fallback.getUTCFullYear() - DEFAULT_YEARS_BACK);
    const from = earliest?.tradeDate ?? fallback;

    const result = await syncIndexHistory("SP500", { from });

    return Response.json(
      { ok: result.errors.length === 0, from: from.toISOString().slice(0, 10), ...result },
      { status: result.errors.length === 0 ? 200 : 502 }
    );
  } catch (error) {
    console.error("Fetch SP500 cron error", error);
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return verifyCronSecret(request) ?? run();
}

export async function POST(request: Request) {
  return verifyCronSecret(request) ?? run();
}
