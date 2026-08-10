"use client";

import { ChartCard } from "@/components/dashboard/chart-card";
import { formatSignedPercentValue } from "@/components/rendimientos/chart-utils";
import type { MonthlyReturn, ViewCurrency } from "@/lib/rendimientos/types";

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

type Props = { data: MonthlyReturn[]; currency: ViewCurrency };

export function MonthlyReturns({ data, currency }: Props) {
  const years = [...new Set(data.map((item) => item.year))].sort((a, b) => a - b);
  const byKey = new Map(data.map((item) => [`${item.year}-${item.month}`, item]));

  return (
    <ChartCard
      title="Retornos mensuales"
      description="Variación del valor entre el cierre de un mes y el siguiente."
    >
      {years.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
          Todavía no hay suficientes snapshots para calcular retornos mensuales.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[64px_repeat(12,minmax(0,1fr))] gap-1.5 text-center text-[11px] text-zinc-500">
              <span />
              {MONTHS.map((month) => <span key={month}>{month}</span>)}
              {years.map((year) => (
                <div key={year} className="contents">
                  <span className="self-center text-left font-medium text-zinc-400">{year}</span>
                  {MONTHS.map((_, month) => {
                    const item = byKey.get(`${year}-${month}`);
                    const value = currency === "ARS" ? item?.returnArs : item?.returnUsd;
                    return <ReturnCell key={`${year}-${month}`} value={value ?? null} />;
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </ChartCard>
  );
}

function ReturnCell({ value }: { value: number | null }) {
  const intensity = value === null ? 0 : Math.min(Math.abs(value) / 8, 1);
  const backgroundColor = value === null
    ? "#18181b"
    : value >= 0
      ? `rgba(16, 185, 129, ${0.12 + intensity * 0.55})`
      : `rgba(244, 63, 94, ${0.12 + intensity * 0.55})`;
  return (
    <span
      title={value === null ? "Sin dato" : formatSignedPercentValue(value)}
      className="flex min-h-9 items-center justify-center rounded-md border border-zinc-800/70 px-1 tabular-nums text-[11px] text-zinc-200"
      style={{ backgroundColor }}
    >
      {value === null ? "—" : formatSignedPercentValue(value)}
    </span>
  );
}
