/**
 * Backfill de series macro: CCL histórico, inflación, Merval y S&P 500.
 *
 * Corre antes que `backfill-prices` porque la valuación en USD necesita el CCL del
 * día. Declarado en `vercel.json`.
 *
 * El rango arranca en la primera transacción registrada en toda la base: es el
 * histórico que efectivamente le corresponde a los usuarios. Si no hay ninguna
 * transacción todavía, no hay nada que backfillear.
 *
 * Prueba local: `curl -X POST http://localhost:3000/api/cron/backfill-macro`
 */

import { verifyCronSecret } from "@/lib/cron/auth";
import { runMacroBackfill } from "@/lib/market/backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(): Promise<Response> {
  try {
    const result = await runMacroBackfill();
    if ("skipped" in result) {
      return Response.json(result);
    }
    // 207: algo entró pero no todo. Un proveedor caído no invalida los otros tres.
    return Response.json(result, { status: result.errors.length === 0 ? 200 : 207 });
  } catch (error) {
    console.error("Backfill macro cron error", error);
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return verifyCronSecret(request) ?? run();
}

export async function POST(request: Request) {
  return verifyCronSecret(request) ?? run();
}
