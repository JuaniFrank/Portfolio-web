"use client";

import { CalendarDays, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { DataNotices } from "@/components/rendimientos/data-notices";
import { DrawdownChart } from "@/components/rendimientos/drawdown-chart";
import { MonthlyReturnChart } from "@/components/rendimientos/monthly-return-chart";
import { MonthlyReturns } from "@/components/rendimientos/monthly-returns";
import { MonthlyTable } from "@/components/rendimientos/monthly-table";
import { PerformanceKpis } from "@/components/rendimientos/performance-kpis";
import { PortfolioVsBenchmark } from "@/components/rendimientos/portfolio-vs-benchmark";
import { ValueEvolution } from "@/components/rendimientos/value-evolution";
import { formatDateLong } from "@/components/rendimientos/chart-utils";
import type { PerformanceReport, ViewCurrency } from "@/lib/rendimientos/types";
import { PERIODS, resolveView, summaryForCurrency, type Period } from "@/lib/rendimientos/view";
import { cn } from "@/lib/utils";

export function RendimientosPage({ report }: { report: PerformanceReport }) {
  const [period, setPeriod] = useState<Period>("ALL");
  const [currency, setCurrency] = useState<ViewCurrency>("ARS");

  // La vista en USD depende de tener CCL para todos los meses; si no hay ninguno, el
  // toggle se deshabilita en vez de mostrar una serie de ceros.
  const usdAvailable = report.months.some((row) => row.cclMonthEnd !== null);

  const view = useMemo(() => resolveView(report, currency, period), [report, currency, period]);
  const summary = useMemo(
    () => summaryForCurrency(view.summary, currency),
    [view.summary, currency]
  );
  const monthsByKey = useMemo(
    () => new Map(report.months.map((row) => [row.month, row])),
    [report.months]
  );

  const hasData = report.months.length > 0;

  return (
    <div className="space-y-6">
      <Header report={report} />

      <DataNotices quality={report.dataQuality} excludedHoldings={report.excludedHoldings} />

      {!hasData ? (
        <EmptyState />
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <CalendarDays className="h-4 w-4 text-teal-400" />
              <span>Período</span>
              <div className="flex flex-wrap rounded-md border border-zinc-800 bg-zinc-950/60 p-1">
                {PERIODS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setPeriod(option.id)}
                    aria-pressed={period === option.id}
                    className={cn(
                      "rounded px-2.5 py-1.5 text-xs transition-colors",
                      period === option.id
                        ? "bg-teal-500/20 font-medium text-teal-300"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    )}
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
                  aria-pressed={currency === option}
                  title={
                    option === "USD" && !usdAvailable
                      ? "Falta el histórico de CCL para convertir a dólares"
                      : undefined
                  }
                  className={cn(
                    "rounded px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                    currency === option
                      ? "bg-teal-500/20 font-medium text-teal-300"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <PerformanceKpis summary={summary} currency={currency} />

          <div className="space-y-4">
            <ValueEvolution data={view.rows} currency={currency} />
            <MonthlyReturnChart
              data={view.rows}
              benchmarks={view.benchmarks}
              currency={currency}
            />
            <PortfolioVsBenchmark
              data={view.rows}
              benchmarks={view.benchmarks}
              currency={currency}
            />
            <DrawdownChart data={view.rows} />
            <MonthlyReturns data={view.rows} currency={currency} />
            <MonthlyTable rows={view.rows} monthsByKey={monthsByKey} currency={currency} />
          </div>
        </>
      )}
    </div>
  );
}

function Header({ report }: { report: PerformanceReport }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Rendimientos</h1>
        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
          {report.portfolioName}
        </span>
        {report.dataQuality.lastPriceSyncDate ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/50 px-2 py-0.5 text-xs text-zinc-500">
            <RefreshCw className="h-3 w-3" />
            Precios al {formatDateLong(report.dataQuality.lastPriceSyncDate)}
          </span>
        ) : null}
      </div>
      <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
        Serie reconstruida desde tus operaciones y el histórico de precios de cada ticker —
        no depende de capturas diarias, así que corregir o importar una operación vieja
        actualiza todo el histórico.
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 p-8 text-center">
      <p className="text-sm font-medium text-zinc-300">Todavía no hay nada que medir</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-500">
        Cargá tus operaciones y depósitos para que el motor pueda reconstruir la serie de
        rendimientos mes a mes.
      </p>
    </div>
  );
}
