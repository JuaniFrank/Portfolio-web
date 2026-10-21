import { prisma } from "@/lib/prisma";
import { calculatePortfolioValuation } from "@/lib/calculations/performance";
import { summarizeSnapshotRun, type PortfolioRunResult } from "@/lib/snapshots/cron-summary";

// Vercel Cron hits this on a schedule (see vercel.json). Requests carry
// `Authorization: Bearer $CRON_SECRET`, which we verify so the endpoint can't
// be triggered by anyone who guesses the URL.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function verifyCronSecret(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

async function runSnapshotsCron() {
  try {
    const now = new Date();
    // Truncar al inicio del día (UTC) para que el upsert diario sea idempotente
    // contra la clave única [portfolioId, date].
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const users = await prisma.user.findMany({ include: { portfolios: true } });
    const results: PortfolioRunResult[] = [];

    for (const user of users) {
      for (const portfolio of user.portfolios) {
        // One failing portfolio must not abort the rest: isolate each one.
        try {
          const perf = await calculatePortfolioValuation(portfolio.id);

          await prisma.portfolioSnapshot.upsert({
            where: {
              portfolioId_date: {
                portfolioId: portfolio.id,
                date: day,
              },
            },
            create: {
              portfolioId: portfolio.id,
              date: day,
              totalValueArs: perf.totalValueArs,
              totalValueUsd: perf.totalValueUsd,
              cashArs: perf.cashArs,
              cashUsd: perf.cashUsd,
              netDepositsArs: perf.netDepositsArs,
              netDepositsUsd: perf.netDepositsUsd,
              twrSinceInception: perf.twrSinceInception,
              positions: perf.positions,
            },
            update: {
              totalValueArs: perf.totalValueArs,
              totalValueUsd: perf.totalValueUsd,
              cashArs: perf.cashArs,
              cashUsd: perf.cashUsd,
              netDepositsArs: perf.netDepositsArs,
              netDepositsUsd: perf.netDepositsUsd,
              twrSinceInception: perf.twrSinceInception,
              positions: perf.positions,
            },
          });

          const priceIssueTickers = [
            ...new Set([...perf.priceIssues.valuedAtCost, ...perf.priceIssues.stale]),
          ];
          if (priceIssueTickers.length > 0) {
            console.warn(
              `Snapshot cron: portfolio ${portfolio.id} valued with missing/stale prices`,
              perf.priceIssues
            );
          }
          results.push({ portfolioId: portfolio.id, ok: true, priceIssueTickers });
        } catch (error) {
          console.error(`Snapshot cron: portfolio ${portfolio.id} failed`, error);
          results.push({ portfolioId: portfolio.id, ok: false });
        }
      }
    }

    const { status, ...summary } = summarizeSnapshotRun(results);
    return Response.json(summary, { status });
  } catch (e) {
    console.error("Snapshot cron error", e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;
  return runSnapshotsCron();
}

// POST queda para pruebas locales: curl -X POST http://localhost:3000/api/cron/snapshots
export async function POST(request: Request) {
  const unauthorized = verifyCronSecret(request);
  if (unauthorized) return unauthorized;
  return runSnapshotsCron();
}
