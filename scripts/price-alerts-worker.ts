/**
 * Worker de alertas de precio: corre `runPriceAlerts` en loop, cada N minutos y solo con
 * algún mercado abierto (BYMA 11:00-17:00 hora de Buenos Aires, EE.UU. 9:30-16:00 hora de
 * Nueva York, de lunes a viernes). Es la contraparte intradiaria del cron diario de
 * Vercel (`/api/cron/price-alerts`): ambos ejecutan exactamente el mismo caso de uso.
 *
 *   pnpm alerts:worker
 *
 * Variables: `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` y, opcional,
 * `PRICE_ALERTS_INTERVAL_MINUTES` (por defecto 10).
 *
 * Importa solo dominio y adaptadores de `src/lib/alerts` (nada de UI: lightweight-charts
 * no se puede cargar desde `tsx`). Termina limpio con SIGINT/SIGTERM: si hay una corrida
 * en curso, espera a que termine.
 */

import { runPriceAlerts } from "../src/lib/alerts/adapters/run";
import { marketsOpenAt } from "../src/lib/alerts/market-hours";
import { parseIntervalMinutes } from "../src/lib/alerts/worker-config";
import { prisma } from "../src/lib/prisma";

const intervalMinutes = parseIntervalMinutes(process.env.PRICE_ALERTS_INTERVAL_MINUTES);
const intervalMs = intervalMinutes * 60_000;

let stopping = false;
let wake: (() => void) | null = null;

function requestStop(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[alerts] ${signal} recibido: cerrando…`);
  wake?.();
}

/** Espera `ms`, o menos si llega una señal de cierre. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      wake = null;
      resolve();
    }
    wake = done;
  });
}

async function tick() {
  const now = new Date();
  const open = marketsOpenAt(now);
  if (!open.anyOpen) {
    console.log(`[alerts] ${now.toISOString()} mercados cerrados: sin evaluar`);
    return;
  }
  try {
    const summary = await runPriceAlerts(now);
    console.log(`[alerts] ${now.toISOString()} BYMA=${open.byma} US=${open.us}`, summary);
  } catch (error) {
    // Una corrida fallida no tira el worker: se reintenta en el próximo ciclo.
    console.error("[alerts] la evaluación falló", error);
  }
}

async function main() {
  process.on("SIGINT", () => requestStop("SIGINT"));
  process.on("SIGTERM", () => requestStop("SIGTERM"));

  console.log(`[alerts] worker iniciado: cada ${intervalMinutes} min, solo con mercados abiertos`);
  while (!stopping) {
    await tick();
    if (!stopping) await sleep(intervalMs);
  }
  await prisma.$disconnect();
  console.log("[alerts] worker detenido");
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
