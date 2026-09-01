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
import { runPriceBackfill } from "@/lib/market/backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(): Promise<Response> {
  try {
    const result = await runPriceBackfill();
    if ("skipped" in result) {
      return Response.json(result);
    }
    return Response.json(result, { status: result.errors.length === 0 ? 200 : 207 });
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
