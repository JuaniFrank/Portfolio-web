/**
 * Evaluación de objetivos de precio → aviso por Telegram.
 *
 * Mide cada objetivo armado contra su precio actual (CEDEAR: acción original en USD;
 * acción local: el papel en ARS) y avisa los que se cumplen, una sola vez cada uno. Un
 * aviso que no salió (Telegram sin configurar o caído) se reintenta en la corrida siguiente.
 *
 * Declarado en `vercel.json` **una vez por día** (después del cierre de EE.UU.): el plan
 * Hobby rechaza el deploy con crons de menor frecuencia. La cadencia intradiaria es
 * trabajo del worker (`scripts/price-alerts-worker.ts`), que corre este mismo caso de
 * uso en loop. Si el proyecto pasa a Pro, se puede subir la frecuencia acá.
 *
 * Prueba local: `curl -X POST http://localhost:3000/api/cron/price-alerts`
 */

import { verifyCronSecret } from "@/lib/cron/auth";
import { runPriceAlerts } from "@/lib/alerts/adapters/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(): Promise<Response> {
  try {
    const summary = await runPriceAlerts();
    return Response.json({ ok: true, ...summary }, { status: summary.failed === 0 ? 200 : 207 });
  } catch (error) {
    console.error("Price alerts cron error", error);
    return Response.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return verifyCronSecret(request) ?? run();
}

export async function POST(request: Request) {
  return verifyCronSecret(request) ?? run();
}
