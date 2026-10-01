"use client";

import { Suspense, use, useMemo } from "react";
import { ChartBlockSkeleton, KpiCardRowSkeleton } from "@/components/layout/page-skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { buildDashboardNotices } from "@/lib/dashboard/dashboard-notices";
import type { DashboardData } from "@/lib/dashboard/types";
import { buildPeriodKpis } from "@/lib/dashboard/period-kpis";
import type { TimeRange } from "@/lib/dashboard/time-range";
import type { PortfolioEvolution } from "@/lib/dashboard/evolution";
import { DayMovers } from "./day-movers";
import type { ViewCurrency } from "./format";
import { NoticesPanel } from "./notices-panel";
import { PeriodKpisPanel } from "./period-kpis-panel";
import { PortfolioEvolutionChart } from "./portfolio-evolution";

/**
 * Secciones del dashboard que dependen de la serie histórica reconstruida. La serie es
 * la parte lenta del loader, así que llega como promesa desde el server y cada sección
 * se suspende por su cuenta: el resto de la página pinta sin esperarla.
 */

type EvolutionPromise = Promise<PortfolioEvolution>;

export function EvolutionNotices({
  evolution,
  cclMissing,
  concentration,
}: {
  evolution: EvolutionPromise;
  cclMissing: boolean;
  concentration: DashboardData["concentration"];
}) {
  // Sin fallback: los avisos están ocultos cuando no hay nada que reportar.
  return (
    <Suspense fallback={null}>
      <Notices evolution={evolution} cclMissing={cclMissing} concentration={concentration} />
    </Suspense>
  );
}

function Notices({
  evolution,
  cclMissing,
  concentration,
}: {
  evolution: EvolutionPromise;
  cclMissing: boolean;
  concentration: DashboardData["concentration"];
}) {
  const resolved = use(evolution);
  const lastPoint = resolved.series.daily.at(-1) ?? null;
  const notices = useMemo(
    () => buildDashboardNotices({ cclMissing, lastPoint, concentration }),
    [cclMissing, lastPoint, concentration]
  );
  return <NoticesPanel notices={notices} />;
}

export function EvolutionPeriodKpis({
  evolution,
  currency,
}: {
  evolution: EvolutionPromise;
  currency: ViewCurrency;
}) {
  return (
    <Suspense fallback={<KpiCardRowSkeleton count={4} />}>
      <PeriodKpis evolution={evolution} currency={currency} />
    </Suspense>
  );
}

function PeriodKpis({ evolution, currency }: { evolution: EvolutionPromise; currency: ViewCurrency }) {
  const resolved = use(evolution);
  const kpis = useMemo(
    () => buildPeriodKpis(resolved.series.daily, resolved.instruments, currency),
    [resolved.series.daily, resolved.instruments, currency]
  );
  return <PeriodKpisPanel kpis={kpis} currency={currency} />;
}

export function EvolutionChart({
  evolution,
  currency,
  initialRange,
}: {
  evolution: EvolutionPromise;
  currency: ViewCurrency;
  initialRange: TimeRange;
}) {
  return (
    <Suspense fallback={<Skeleton className="h-80 w-full" />}>
      <Chart evolution={evolution} currency={currency} initialRange={initialRange} />
    </Suspense>
  );
}

function Chart({
  evolution,
  currency,
  initialRange,
}: {
  evolution: EvolutionPromise;
  currency: ViewCurrency;
  initialRange: TimeRange;
}) {
  return (
    <PortfolioEvolutionChart
      evolution={use(evolution)}
      currency={currency}
      initialRange={initialRange}
    />
  );
}

export function EvolutionDayMovers({
  evolution,
  currency,
}: {
  evolution: EvolutionPromise;
  currency: ViewCurrency;
}) {
  return (
    <Suspense fallback={<ChartBlockSkeleton heightClass="h-32" />}>
      <Movers evolution={evolution} currency={currency} />
    </Suspense>
  );
}

function Movers({ evolution, currency }: { evolution: EvolutionPromise; currency: ViewCurrency }) {
  const lastPoint = use(evolution).series.daily.at(-1) ?? null;
  return (
    <DayMovers
      gainers={lastPoint?.gainers ?? []}
      losers={lastPoint?.losers ?? []}
      currency={currency}
    />
  );
}
