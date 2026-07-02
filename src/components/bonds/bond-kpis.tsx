"use client";

import { BarChart3, Coins, TrendingUp, Wallet } from "lucide-react";
import type { BondKpis } from "@/lib/bonds/types";
import { cn } from "@/lib/utils";
import { formatMoney } from "./format";

type Props = {
  kpis: BondKpis;
  cclMid: string | null;
  holdingsCount: number;
  flowsCount: number;
};

type Accent = "emerald" | "rose" | "amber" | "violet" | "sky";

const ACCENTS: Record<Accent, string> = {
  emerald: "text-emerald-400",
  rose: "text-rose-400",
  amber: "text-amber-400",
  violet: "text-violet-400",
  sky: "text-sky-400",
};

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: Accent;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        <Icon className={cn("h-4 w-4 text-zinc-500", accent && ACCENTS[accent])} />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-50">{value}</p>
      {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

function DualKpi({
  icon: Icon,
  label,
  primary,
  secondary,
  sub,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: string;
  secondary: string;
  sub?: string;
  accent?: Accent;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
        <Icon className={cn("h-4 w-4 text-zinc-500", accent && ACCENTS[accent])} />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-50">{primary}</p>
      <p className={cn("text-sm font-medium tabular-nums", accent ? ACCENTS[accent] : "text-zinc-300")}>
        {secondary}
      </p>
      {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}

export function BondKpiCards({ kpis, cclMid, holdingsCount, flowsCount }: Props) {
  const cclSub = cclMid ? `CCL ${formatMoney(cclMid, "ARS")}` : "Sin CCL";

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <DualKpi
        icon={Wallet}
        label="Valor de mercado"
        primary={formatMoney(kpis.totalMarketValueUsd, "USD")}
        secondary={formatMoney(kpis.totalMarketValueArs, "ARS")}
        sub={cclSub}
        accent="sky"
      />
      <Kpi
        icon={TrendingUp}
        label="Cupones recibidos YTD"
        value={formatMoney(kpis.couponsYtdUsd, "USD")}
        sub={`Año ${new Date().getUTCFullYear()}`}
        accent="emerald"
      />
      <Kpi
        icon={BarChart3}
        label="Posiciones activas"
        value={String(holdingsCount)}
        sub={holdingsCount === 1 ? "instrumento" : "instrumentos"}
        accent="amber"
      />
      <Kpi
        icon={Coins}
        label="Flujos recibidos"
        value={String(flowsCount)}
        sub="cupones + amortizaciones"
        accent="violet"
      />
    </div>
  );
}
