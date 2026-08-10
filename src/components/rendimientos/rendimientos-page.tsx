"use client";

import { CalendarDays, ShieldCheck, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { formatMoney, formatSignedPercent } from "@/components/dashboard/format";
import { DrawdownChart } from "@/components/rendimientos/drawdown-chart";
import { MonthlyReturns } from "@/components/rendimientos/monthly-returns";
import { PerformanceKpis } from "@/components/rendimientos/performance-kpis";
import { PortfolioVsBenchmark } from "@/components/rendimientos/portfolio-vs-benchmark";
import { formatDateLong } from "@/components/rendimientos/chart-utils";
import { ValueEvolution } from "@/components/rendimientos/value-evolution";
import { cn } from "@/lib/utils";
import type { ChartPoint, PerformanceData, ViewCurrency } from "@/lib/rendimientos/types";

type Period = "1M" | "3M" | "6M" | "YTD" | "1A" | "ALL";

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: "1M", label: "1M" },
  { id: "3M", label: "3M" },
  { id: "6M", label: "6M" },
  { id: "YTD", label: "YTD" },
  { id: "1A", label: "1A" },
  { id: "ALL", label: "Todo" },
];

export function RendimientosPage({ data }: { data: PerformanceData }) {
  const [period, setPeriod] = useState<Period>("ALL");
  const [currency, setCurrency] = useState<ViewCurrency>("ARS");
  const usdAvailable = data.points.some((point) => point.valueUsd !== 0 || point.depositsUsd !== 0);

  const visiblePoints = useMemo(() => filterPoints(data, period), [data, period]);
  const chartData = useMemo(
    () => buildChartPoints(visiblePoints, currency),
    [visiblePoints, currency]
  );
  const metrics = useMemo(() => buildPeriodMetrics(chartData), [chartData]);
  const monthlyReturns = useMemo(
    () => filterMonthlyReturns(data.monthlyReturns, visiblePoints),
    [data.monthlyReturns, visiblePoints]
  );

  const summary = currency === "ARS"
    ? {
        daily: data.summary.dailyReturnArs,
        weekly: data.summary.weeklyReturnArs,
        monthly: data.summary.monthlyReturnArs,
      }
    : {
        daily: data.summary.dailyReturnUsd,
        weekly: data.summary.weeklyReturnUsd,
        monthly: data.summary.monthlyReturnUsd,
      };

  return (
    <div className="space-y-6">
      <Header data={data} />

      {data.points.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <CalendarDays className="h-4 w-4 text-teal-400" />
              <span>Período</span>
              <div className="flex flex-wrap rounded-md border border-zinc-800 bg-zinc-950/60 p-1">
                {PERIODS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPeriod(option.id)}
                    className={cn(
                      "rounded px-2.5 py-1.5 text-xs transition-colors",
                      period === option.id
                        ? "bg-teal-500/20 font-medium text-teal-300"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    )}
                    aria-pressed={period === option.id}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="inline-flex w-fit rounded-md border border-zinc-800 bg-zinc-950/60 p-1">
              {(["ARS", "USD"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={option === "USD" && !usdAvailable}
                  onClick={() => setCurrency(option)}
                  className={cn(
                    "rounded px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    currency === option
                      ? "bg-teal-500/20 font-medium text-teal-300"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  )}
                  aria-pressed={currency === option}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <PerformanceKpis
            currency={currency}
            currentValue={metrics.currentValue}
            periodReturn={metrics.periodReturn}
            periodReturnPercent={metrics.periodReturnPercent}
            maxDrawdown={metrics.maxDrawdown}
            netDeposits={metrics.netDeposits}
            gainVsDeposits={metrics.currentValue - metrics.netDeposits}
          />

          <RecentReturns currency={currency} daily={summary.daily} weekly={summary.weekly} monthly={summary.monthly} />

          <div className="space-y-4">
            <PortfolioVsBenchmark data={chartData} benchmarkAvailable={data.benchmarkAvailable} />
            <ValueEvolution data={chartData} currency={currency} />
            <DrawdownChart data={chartData} />
            <MonthlyReturns data={monthlyReturns} currency={currency} />
          </div>
        </>
      )}
    </div>
  );
}

function Header({ data }: { data: PerformanceData }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Rendimientos</h1>
        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
          {data.portfolioName}
        </span>
        {data.lastSnapshotDate ? (
          <span className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-0.5 text-xs text-zinc-500">
            Actualizado {formatDateLong(data.lastSnapshotDate)}
          </span>
        ) : null}
      </div>
      <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
        Evolución del capital, rendimiento frente al S&P 500 y riesgo de tu portfolio.
      </p>
    </div>
  );
}

function RecentReturns({
  currency,
  daily,
  weekly,
  monthly,
}: {
  currency: ViewCurrency;
  daily: number | null;
  weekly: number | null;
  monthly: number | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-zinc-800/80 bg-zinc-900/20 px-4 py-3 text-xs">
      <div className="flex items-center gap-2 text-zinc-500">
        <TrendingUp className="h-4 w-4 text-teal-400" />
        Variación reciente ({currency})
      </div>
      <ReturnItem label="1D" value={daily} />
      <ReturnItem label="1S" value={weekly} />
      <ReturnItem label="1M" value={monthly} />
    </div>
  );
}

function ReturnItem({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-zinc-600">{label}</span>
      <span className={cn("font-medium tabular-nums", value === null ? "text-zinc-600" : value >= 0 ? "text-emerald-400" : "text-rose-400")}>
        {value === null ? "—" : formatSignedPercent(value)}
      </span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
      <ShieldCheck className="mx-auto h-8 w-8 text-teal-400/70" />
      <p className="mt-4 text-base font-medium text-zinc-200">Todavía no hay snapshots de rendimiento</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
        La vista se completa automáticamente cuando el proceso diario de snapshots registra el valor de tu portfolio.
      </p>
    </div>
  );
}

function filterPoints(data: PerformanceData, period: Period) {
  const points = data.points;
  const last = points.at(-1);
  if (!last || period === "ALL") return points;

  const lastDate = new Date(last.date);
  const cutoff = new Date(lastDate);
  if (period === "YTD") {
    cutoff.setUTCMonth(0, 1);
    cutoff.setUTCHours(0, 0, 0, 0);
  } else {
    const months = period === "1M" ? 1 : period === "3M" ? 3 : period === "6M" ? 6 : 12;
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  }
  const filtered = points.filter((point) => new Date(point.date).getTime() >= cutoff.getTime());
  return filtered.length > 0 ? filtered : [last];
}

function buildChartPoints(points: PerformanceData["points"], currency: ViewCurrency): ChartPoint[] {
  const firstValue = currency === "ARS" ? points[0]?.valueArs : points[0]?.valueUsd;
  const benchmarkBase = points.find((point) => point.benchmarkClose !== null)?.benchmarkClose ?? null;
  let peak = 0;

  return points.map((point) => {
    const value = currency === "ARS" ? point.valueArs : point.valueUsd;
    const deposits = currency === "ARS" ? point.depositsArs : point.depositsUsd;
    peak = Math.max(peak, value);
    return {
      date: point.date,
      value,
      deposits,
      portfolioIndex: firstValue && firstValue > 0 ? (value / firstValue) * 100 : 100,
      benchmarkIndex:
        benchmarkBase && point.benchmarkClose !== null
          ? (point.benchmarkClose / benchmarkBase) * 100
          : null,
      drawdown: peak > 0 ? (value / peak - 1) * 100 : 0,
    };
  });
}

function buildPeriodMetrics(points: ChartPoint[]) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) {
    return { currentValue: 0, periodReturn: 0, periodReturnPercent: null, maxDrawdown: 0, netDeposits: 0 };
  }
  return {
    currentValue: last.value,
    periodReturn: last.value - first.value,
    periodReturnPercent: first.value > 0 ? (last.value / first.value - 1) * 100 : null,
    maxDrawdown: Math.min(...points.map((point) => point.drawdown)),
    netDeposits: last.deposits,
  };
}

function filterMonthlyReturns(
  monthlyReturns: PerformanceData["monthlyReturns"],
  points: PerformanceData["points"]
) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return [];
  const firstDate = new Date(first.date);
  const lastDate = new Date(last.date);
  return monthlyReturns.filter((item) => {
    const date = new Date(Date.UTC(item.year, item.month, 1));
    return date.getTime() <= lastDate.getTime() && date.getUTCFullYear() >= firstDate.getUTCFullYear() &&
      (date.getUTCFullYear() > firstDate.getUTCFullYear() || date.getUTCMonth() >= firstDate.getUTCMonth());
  });
}
