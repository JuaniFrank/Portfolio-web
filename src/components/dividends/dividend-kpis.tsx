"use client";

import { ArrowDownRight, ArrowUpRight, CalendarClock, Coins, Percent, Trophy } from "lucide-react";
import type { DividendKpis } from "@/lib/dividends/types";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent, type ViewCurrency } from "./format";

type Props = {
  kpis: DividendKpis;
  currency: ViewCurrency;
};

export function DividendKpiCards({ kpis, currency }: Props) {
  const isArs = currency === "ARS";
  const totalNet = isArs ? kpis.totalNetArs : kpis.totalNetUsd;
  const totalGross = isArs ? kpis.totalGrossArs : kpis.totalGrossUsd;
  const totalTax = isArs ? kpis.totalTaxArs : kpis.totalTaxUsd;
  const ytdNet = isArs ? kpis.ytdNetArs : kpis.ytdNetUsd;
  const lastYearNet = isArs ? kpis.lastYearNetArs : kpis.lastYearNetUsd;
  const next30 = isArs ? kpis.next30dEstimatedArs : kpis.next30dEstimatedUsd;
  const topTickerNet = kpis.topTicker
    ? isArs
      ? kpis.topTicker.netArs
      : kpis.topTicker.netUsd
    : null;

  const ytdNum = Number(ytdNet);
  const lyNum = Number(lastYearNet);
  const delta = lyNum > 0 ? ((ytdNum - lyNum) / lyNum) * 100 : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <Kpi
        icon={Coins}
        label="Total recibido neto"
        value={formatMoney(totalNet, currency)}
        sub={`${kpis.totalPayments} ${kpis.totalPayments === 1 ? "pago" : "pagos"}`}
        accent="emerald"
      />
      <Kpi
        icon={ArrowUpRight}
        label="Total bruto"
        value={formatMoney(totalGross, currency)}
        sub="Antes de retenciones"
      />
      <Kpi
        icon={ArrowDownRight}
        label="Retenciones (IIGG + BBPP)"
        value={formatMoney(totalTax, currency)}
        sub={`${formatPercent(kpis.effectiveTaxRate)} efectivo`}
        accent="rose"
      />
      <Kpi
        icon={Trophy}
        label="Mayor pagador"
        value={kpis.topTicker?.ticker ?? "—"}
        sub={topTickerNet ? `${formatMoney(topTickerNet, currency)} neto` : "Sin datos"}
        accent="amber"
      />
      <Kpi
        icon={Percent}
        label={`${new Date().getUTCFullYear()} vs ${new Date().getUTCFullYear() - 1}`}
        value={formatMoney(ytdNet, currency)}
        sub={
          delta === null
            ? "Sin comparativa"
            : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs anterior`
        }
        accent={delta !== null && delta >= 0 ? "emerald" : "rose"}
      />
      <Kpi
        icon={CalendarClock}
        label="Próximos 30 días (estim.)"
        value={formatMoney(next30, currency)}
        sub="En base al histórico"
        accent="violet"
      />
    </div>
  );
}

type Accent = "emerald" | "rose" | "amber" | "violet";

const ACCENTS: Record<Accent, string> = {
  emerald: "text-emerald-400",
  rose: "text-rose-400",
  amber: "text-amber-400",
  violet: "text-violet-400",
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
