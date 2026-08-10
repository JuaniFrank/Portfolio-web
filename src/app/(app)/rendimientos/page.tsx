import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { RendimientosPage } from "@/components/rendimientos/rendimientos-page";
import type {
  MonthlyReturn,
  PerformanceData,
  PerformancePoint,
  PerformanceSummary,
} from "@/lib/rendimientos/types";
import { prisma } from "@/lib/prisma";

export const revalidate = 300;

function safeReturn(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return (current / previous - 1) * 100;
}

function valueAtOrBefore(
  points: PerformancePoint[],
  target: number,
  currency: "ARS" | "USD"
): number | undefined {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point && new Date(point.date).getTime() <= target) {
      return currency === "ARS" ? point.valueArs : point.valueUsd;
    }
  }
  return undefined;
}

function buildMonthlyReturns(points: PerformancePoint[]): MonthlyReturn[] {
  const groups = new Map<string, PerformancePoint[]>();
  for (const point of points) {
    const date = new Date(point.date);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    const group = groups.get(key) ?? [];
    group.push(point);
    groups.set(key, group);
  }

  const sortedGroups = [...groups.entries()].sort(([a], [b]) => {
    const yearA = Number(a.split("-")[0] ?? 0);
    const monthA = Number(a.split("-")[1] ?? 0);
    const yearB = Number(b.split("-")[0] ?? 0);
    const monthB = Number(b.split("-")[1] ?? 0);
    return yearA - yearB || monthA - monthB;
  });
  return sortedGroups.map(([key, group], groupIndex) => {
    const [yearText, monthText] = key.split("-");
    const previous = groupIndex > 0 ? sortedGroups[groupIndex - 1]?.[1].at(-1) : undefined;
    const last = group.at(-1);
    return {
      year: Number(yearText),
      month: Number(monthText),
      returnArs: last && previous ? safeReturn(last.valueArs, previous.valueArs) : null,
      returnUsd: last && previous ? safeReturn(last.valueUsd, previous.valueUsd) : null,
    };
  });
}

function emptySummary(): PerformanceSummary {
  return {
    totalReturnArs: null,
    totalReturnUsd: null,
    gainVsDepositsArs: null,
    gainVsDepositsUsd: null,
    dailyReturnArs: null,
    dailyReturnUsd: null,
    weeklyReturnArs: null,
    weeklyReturnUsd: null,
    monthlyReturnArs: null,
    monthlyReturnUsd: null,
    maxDrawdownArs: 0,
    maxDrawdownUsd: 0,
  };
}

function buildSummary(points: PerformancePoint[]): PerformanceSummary {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return emptySummary();

  const lastTime = new Date(last.date).getTime();
  const weekAgo = lastTime - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = lastTime - 30 * 24 * 60 * 60 * 1000;
  const weekArs = valueAtOrBefore(points, weekAgo, "ARS");
  const weekUsd = valueAtOrBefore(points, weekAgo, "USD");
  const monthArs = valueAtOrBefore(points, monthAgo, "ARS");
  const monthUsd = valueAtOrBefore(points, monthAgo, "USD");

  return {
    totalReturnArs: safeReturn(last.valueArs, first.valueArs),
    totalReturnUsd: safeReturn(last.valueUsd, first.valueUsd),
    gainVsDepositsArs: last.valueArs - last.depositsArs,
    gainVsDepositsUsd: last.valueUsd - last.depositsUsd,
    dailyReturnArs: last.dailyReturnArs,
    dailyReturnUsd: last.dailyReturnUsd,
    weeklyReturnArs: safeReturn(last.valueArs, weekArs),
    weeklyReturnUsd: safeReturn(last.valueUsd, weekUsd),
    monthlyReturnArs: safeReturn(last.valueArs, monthArs),
    monthlyReturnUsd: safeReturn(last.valueUsd, monthUsd),
    maxDrawdownArs: Math.min(...points.map((point) => point.drawdownArs)),
    maxDrawdownUsd: Math.min(...points.map((point) => point.drawdownUsd)),
  };
}

async function fetchData(
  portfolioId: string,
  portfolioName: string
): Promise<PerformanceData | null> {
  try {
    const [snapshots, spySnapshots] = await Promise.all([
      prisma.portfolioSnapshot.findMany({
        where: { portfolioId },
        orderBy: [{ date: "asc" }],
        select: {
          date: true,
          totalValueArs: true,
          totalValueUsd: true,
          cashArs: true,
          cashUsd: true,
          netDepositsArs: true,
          netDepositsUsd: true,
          twrSinceInception: true,
          positions: true,
        },
      }),
      prisma.sp500Snapshot.findMany({
        orderBy: [{ date: "asc" }],
        select: { date: true, close: true },
      }),
    ]);

    let benchmarkIndex = 0;
    let latestBenchmarkClose: number | null = null;
    let peakArs = 0;
    let peakUsd = 0;
    let previousArs: number | undefined;
    let previousUsd: number | undefined;

    const points: PerformancePoint[] = snapshots.map((snapshot) => {
      while (
        benchmarkIndex < spySnapshots.length &&
        spySnapshots[benchmarkIndex]!.date.getTime() <= snapshot.date.getTime()
      ) {
        latestBenchmarkClose = Number(spySnapshots[benchmarkIndex]!.close);
        benchmarkIndex += 1;
      }

      const valueArs = Number(snapshot.totalValueArs);
      const valueUsd = Number(snapshot.totalValueUsd);
      peakArs = Math.max(peakArs, valueArs);
      peakUsd = Math.max(peakUsd, valueUsd);
      const point: PerformancePoint = {
        date: snapshot.date.toISOString(),
        valueArs,
        valueUsd,
        depositsArs: Number(snapshot.netDepositsArs),
        depositsUsd: Number(snapshot.netDepositsUsd),
        benchmarkClose: latestBenchmarkClose,
        dailyReturnArs: safeReturn(valueArs, previousArs),
        dailyReturnUsd: safeReturn(valueUsd, previousUsd),
        drawdownArs: peakArs > 0 ? (valueArs / peakArs - 1) * 100 : 0,
        drawdownUsd: peakUsd > 0 ? (valueUsd / peakUsd - 1) * 100 : 0,
      };
      previousArs = valueArs;
      previousUsd = valueUsd;
      return point;
    });

    const latestSnapshot = snapshots.at(-1);
    return {
      portfolioName,
      points,
      monthlyReturns: buildMonthlyReturns(points),
      summary: buildSummary(points),
      lastSnapshotDate: latestSnapshot?.date.toISOString() ?? null,
      latestSnapshot: latestSnapshot
        ? {
            cashArs: Number(latestSnapshot.cashArs),
            cashUsd: Number(latestSnapshot.cashUsd),
            twrSinceInception:
              latestSnapshot.twrSinceInception === null
                ? null
                : Number(latestSnapshot.twrSinceInception),
            positions: latestSnapshot.positions,
          }
        : null,
      benchmarkAvailable: points.some((point) => point.benchmarkClose !== null),
    };
  } catch (error) {
    console.error("Rendimientos data fetch error", error);
    return null;
  }
}

function emptyData(portfolioName: string): PerformanceData {
  return {
    portfolioName,
    points: [],
    monthlyReturns: [],
    summary: emptySummary(),
    lastSnapshotDate: null,
    latestSnapshot: null,
    benchmarkAvailable: false,
  };
}

export default async function RendimientosRoutePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const portfolio = await prisma.portfolio.findFirst({
    where: { userId: user.id, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });

  if (!portfolio) return <RendimientosPage data={emptyData("Sin portfolio")} />;

  const data = await fetchData(portfolio.id, portfolio.name);
  return <RendimientosPage data={data ?? emptyData(portfolio.name)} />;
}
