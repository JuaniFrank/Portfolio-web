"use client";

import { ArrowDownRight, ArrowUpRight, Landmark, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney, formatSignedPercent } from "@/components/dashboard/format";
import type { ViewCurrency } from "@/lib/rendimientos/types";

type Props = {
  currency: ViewCurrency;
  currentValue: number;
  periodReturn: number;
  periodReturnPercent: number | null;
  maxDrawdown: number;
  netDeposits: number;
  gainVsDeposits: number;
};

export function PerformanceKpis({
  currency,
  currentValue,
  periodReturn,
  periodReturnPercent,
  maxDrawdown,
  netDeposits,
  gainVsDeposits,
}: Props) {
  const positive = periodReturn >= 0;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        icon={Wallet}
        label="Valor actual"
        value={formatMoney(currentValue, currency)}
        detail={`vs aportes ${gainVsDeposits >= 0 ? "+" : ""}${formatMoney(gainVsDeposits, currency)}`}
        accent="indigo"
      />
      <KpiCard
        icon={positive ? ArrowUpRight : ArrowDownRight}
        label="Retorno del período"
        value={`${periodReturn >= 0 ? "+" : ""}${formatMoney(periodReturn, currency)}`}
        detail={periodReturnPercent === null ? "Sin base comparable" : formatSignedPercent(periodReturnPercent)}
        accent={positive ? "emerald" : "rose"}
      />
      <KpiCard
        icon={ArrowDownRight}
        label="Drawdown máximo"
        value={formatSignedPercent(maxDrawdown)}
        detail="Desde el pico del período"
        accent="rose"
      />
      <KpiCard
        icon={Landmark}
        label="Aportes netos"
        value={formatMoney(netDeposits, currency)}
        detail="Acumulados"
        accent="amber"
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
      <p className="mt-1 text-xs text-zinc-500">{detail}</p>
    </div>
  );
}
