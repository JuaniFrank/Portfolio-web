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
import {
  syncCclHistory,
  syncIndexHistory,
  syncInflationHistory,
} from "@/lib/market/history-sync";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Colchón sobre la primera transacción: los benchmarks necesitan el mes anterior. */
const LOOKBACK_DAYS = 45;

async function run(): Promise<Response> {
  try {
    const earliest = await prisma.transaction.findFirst({
      orderBy: { tradeDate: "asc" },
      select: { tradeDate: true },
    });

    if (!earliest) {
      return Response.json({ ok: true, skipped: "sin transacciones registradas" });
    }

    const from = new Date(earliest.tradeDate.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    // Secuencial a propósito: son cuatro proveedores distintos y preferimos ser
    // amables con ellos antes que ganar unos segundos en un cron nocturno.
    const ccl = await syncCclHistory({ from });
    const inflation = await syncInflationHistory();
    const merval = await syncIndexHistory("MERVAL", { from });
    const sp500 = await syncIndexHistory("SP500", { from });

    const errors = [...ccl.errors, ...inflation.errors, ...merval.errors, ...sp500.errors];

    return Response.json(
      {
        ok: errors.length === 0,
        from: from.toISOString().slice(0, 10),
        ccl,
        inflation,
        merval,
        sp500,
      },
      // 207: algo entró pero no todo. Un proveedor caído no invalida los otros tres.
      { status: errors.length === 0 ? 200 : 207 }
    );
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
