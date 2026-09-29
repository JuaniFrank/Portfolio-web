"use client";

import { EMPTY_VALUE, formatSignedPercentOrEmpty, returnToneClass } from "@/components/rendimientos/chart-utils";
import { formatDDMM, type PeriodKpi } from "@/lib/dashboard/period-kpis";
import { cn } from "@/lib/utils";
import { formatMoney, formatSignedMoney, type ViewCurrency } from "./format";

type Props = {
  kpis: PeriodKpi[];
  currency: ViewCurrency;
};

export function PeriodKpisPanel({ kpis, currency }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <PeriodKpiCard key={kpi.id} kpi={kpi} currency={currency} />
      ))}
    </div>
  );
}

function PeriodKpiCard({ kpi, currency }: { kpi: PeriodKpi; currency: ViewCurrency }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{kpi.label}</p>

      {kpi.available ? (
        <div className="mt-2 space-y-1">
          <p className={cn("text-lg font-semibold tabular-nums", returnToneClass(kpi.change))}>
            {formatSignedMoney(kpi.change, currency)}
          </p>
          <p className={cn("text-xs font-medium tabular-nums", returnToneClass(kpi.returnPercent))}>
            {formatSignedPercentOrEmpty(kpi.returnPercent)}
          </p>
          <p className="truncate text-[11px] tabular-nums text-zinc-500">
            Aportes netos: {formatMoney(kpi.netContributions, currency)}
          </p>
          {kpi.partial && kpi.from ? (
            <p className="text-[10px] text-zinc-600">desde {formatDDMM(kpi.from)}</p>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-lg font-semibold text-zinc-600">{EMPTY_VALUE}</p>
      )}
    </div>
  );
}
