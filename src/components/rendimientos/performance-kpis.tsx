"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Landmark,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { formatMoney, formatSignedPercent } from "@/components/dashboard/format";
import { EMPTY_VALUE } from "@/components/rendimientos/chart-utils";
import { formatMonthLabel } from "@/lib/rendimientos/months";
import type { ViewCurrency } from "@/lib/rendimientos/types";
import type { summaryForCurrency } from "@/lib/rendimientos/view";
import { cn } from "@/lib/utils";

type ResolvedSummary = ReturnType<typeof summaryForCurrency>;

/**
 * KPIs del período visible.
 *
 * Los seis números que responden "¿cómo me fue?" sin tener que leer un gráfico. Todos
 * corresponden al período seleccionado, no al histórico completo — si el usuario elige
 * 6 meses, "ganancia" es la de esos 6 meses.
 */
export function PerformanceKpis({
  summary,
  currency,
}: {
  summary: ResolvedSummary;
  currency: ViewCurrency;
}) {
  const positive = (summary.cumulativeReturn ?? 0) >= 0;
  // Anualizar menos de 12 meses es extrapolar; se avisa en vez de presentarlo como un hecho.
  const annualizedIsProjection = summary.monthsTracked > 0 && summary.monthsTracked < 12;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <KpiCard
        icon={Wallet}
        label="Valor invertido"
        value={formatMoney(summary.currentValue, currency)}
        detail={`Capital puesto ${formatMoney(summary.netInvested, currency)}`}
        accent="indigo"
      />
      <KpiCard
        icon={positive ? ArrowUpRight : ArrowDownRight}
        label="Rendimiento del período"
        value={
          summary.cumulativeReturn === null
            ? EMPTY_VALUE
            : formatSignedPercent(summary.cumulativeReturn)
        }
        detail={`Encadenado sobre ${summary.monthsTracked} ${summary.monthsTracked === 1 ? "mes" : "meses"}`}
        accent={positive ? "emerald" : "rose"}
      />
      <KpiCard
        icon={positive ? ArrowUpRight : ArrowDownRight}
        label="Ganancia del período"
        value={formatMoney(summary.gain, currency)}
        detail="Neta del capital que pusiste"
        accent={summary.gain >= 0 ? "emerald" : "rose"}
      />
      <KpiCard
        icon={Landmark}
        label="Anualizado"
        value={
          summary.annualizedReturn === null
            ? EMPTY_VALUE
            : formatSignedPercent(summary.annualizedReturn)
        }
        detail={annualizedIsProjection ? "Proyección: menos de 12 meses" : "Tasa efectiva anual"}
        accent="amber"
      />
      <KpiCard
        icon={TrendingDown}
        label="Drawdown máximo"
        value={formatSignedPercent(summary.maxDrawdown)}
        detail="Caída desde el pico del rendimiento"
        accent="rose"
      />
      <KpiCard
        icon={CalendarRange}
        label="Mejor / peor mes"
        value={
          summary.bestMonth
            ? `${formatSignedPercent(summary.bestMonth.returnPercent)} / ${
                summary.worstMonth ? formatSignedPercent(summary.worstMonth.returnPercent) : EMPTY_VALUE
              }`
            : EMPTY_VALUE
        }
        detail={
          summary.bestMonth && summary.worstMonth
            ? `${formatMonthLabel(summary.bestMonth.month)} / ${formatMonthLabel(summary.worstMonth.month)}`
            : "Sin meses medibles"
        }
        accent="indigo"
      />
    </div>
  );
}

type Accent = "indigo" | "emerald" | "rose" | "amber";

const ACCENTS: Record<Accent, string> = {
  indigo: "text-indigo-400",
  emerald: "text-emerald-400",
  rose: "text-rose-400",
  amber: "text-amber-400",
};

function KpiCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  detail: string;
  accent: Accent;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        <Icon className={cn("h-4 w-4", ACCENTS[accent])} />
      </div>
      <p className="mt-3 truncate text-2xl font-semibold tabular-nums text-zinc-50">{value}</p>
      <p className="mt-1 truncate text-xs text-zinc-500">{detail}</p>
    </div>
  );
}
