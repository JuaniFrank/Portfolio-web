import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_request: Request) {
  try {
    const now = new Date();
    // Truncar al inicio del día (UTC) para que el upsert diario sea idempotente
    // contra la clave única [portfolioId, date].
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const users = await prisma.user.findMany({ include: { portfolios: true } });
    let inserted = 0;

    for (const user of users) {
      for (const portfolio of user.portfolios) {
        const perf = await getPortfolioPerformance(portfolio.id);

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
        inserted++;
      }
    }

    return Response.json({ ok: true, snapshotsCreated: inserted });
  } catch (e) {
    console.error("Snapshot cron error", e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

type PortfolioPerformance = {
  totalValueArs: number;
  totalValueUsd: number;
  cashArs: number;
  cashUsd: number;
  netDepositsArs: number;
  netDepositsUsd: number;
  twrSinceInception: number | null;
  positions: Prisma.InputJsonValue;
};

// TODO: implementar la valuación real del portafolio (suma de holdings + cash,
// conversión CCL a USD, TWR). Ver src/lib/calculations/performance.ts (hoy stub)
// y src/lib/dashboard/build.ts. Hasta entonces se registra un snapshot en cero
// en lugar de datos aleatorios que contaminarían la tabla que lee /rendimientos.
async function getPortfolioPerformance(_portfolioId: string): Promise<PortfolioPerformance> {
  return {
    totalValueArs: 0,
    totalValueUsd: 0,
    cashArs: 0,
    cashUsd: 0,
    netDepositsArs: 0,
    netDepositsUsd: 0,
    twrSinceInception: null,
    positions: {},
  };
}
