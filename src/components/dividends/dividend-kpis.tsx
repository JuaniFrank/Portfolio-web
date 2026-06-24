"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  Coins,
  Info,
  Percent,
  Trophy,
} from "lucide-react";
import type { DividendKpis } from "@/lib/dividends/types";
import { cn } from "@/lib/utils";
import { formatMoney, formatPercent, type ViewCurrency } from "./format";

type Props = {
  kpis: DividendKpis;
  currency: ViewCurrency;
  cclToday: string | null;
};

const NET_TOOLTIP =
  "Los dividendos de CEDEARs se depositan en dólar cable (CCL) y los impuestos se pagan en pesos. Estos pesos se acumulan en 'Impuestos pagados (ARS)'. Mostramos ARS y USD por separado porque mezclarlos no representa lo que cobraste.";

export function DividendKpiCards({ kpis, currency, cclToday }: Props) {
  const isArs = currency === "ARS";
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

  const grossSub = cclToday
    ? `USD ${formatMoney(kpis.totalGrossUsd, "USD")} + ARS ${formatMoney(kpis.totalGrossArs, "ARS")} · CCL ${formatMoney(cclToday, "ARS")}`
    : `USD ${formatMoney(kpis.totalGrossUsd, "USD")} + ARS ${formatMoney(kpis.totalGrossArs, "ARS")} (sin CCL hoy)`;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <DualKpi
        icon={Coins}
        label="Total recibido neto"
        primary={formatMoney(kpis.totalNetArs, "ARS")}
        secondary={`${formatMoney(kpis.totalNetUsd, "USD")} CCL`}
        sub={`${kpis.totalPayments} ${kpis.totalPayments === 1 ? "pago" : "pagos"}`}
        tooltip={NET_TOOLTIP}
        accent="emerald"
      />
      <Kpi
        icon={ArrowUpRight}
        label="Total bruto"
        value={kpis.totalGrossUnifiedArs ? formatMoney(kpis.totalGrossUnifiedArs, "ARS") : "—"}
        sub={grossSub}
      />
      <Kpi
        icon={ArrowDownRight}
        label="Impuestos pagados (ARS)"
        value={formatMoney(kpis.totalTaxArs, "ARS")}
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

function DualKpi({
  icon: Icon,
  label,
  primary,
  secondary,
  sub,
  tooltip,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: string;
  secondary: string;
  sub?: string;
  tooltip?: string;
  accent?: Accent;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
          {tooltip ? (
            <span title={tooltip} className="cursor-help text-zinc-600">
              <Info className="h-3 w-3" />
            </span>
          ) : null}
        </div>
        <Icon className={cn("h-4 w-4 text-zinc-500", accent && ACCENTS[accent])} />
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-zinc-50">{primary}</p>
      <p
        className={cn(
          "text-sm font-medium tabular-nums",
          accent ? ACCENTS[accent] : "text-zinc-300"
        )}
      >
        {secondary}
      </p>
      {sub ? <p className="mt-1 text-xs text-zinc-500">{sub}</p> : null}
    </div>
  );
}
