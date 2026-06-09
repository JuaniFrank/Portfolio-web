"use client";

import { useMemo } from "react";
import type { SectorBar } from "@/lib/dashboard/types";
import { SECTOR_COLORS, formatMoney, formatPercent, type ViewCurrency } from "./format";

type Props = {
  data: SectorBar[];
  currency: ViewCurrency;
};

export function SectorBars({ data, currency }: Props) {
  const rows = useMemo(() => {
    if (data.length === 0) return [];
    const max = Math.max(...data.map((d) => Number(d.percent)));
    return data.map((d) => ({
      ...d,
      barWidth: max > 0 ? (Number(d.percent) / max) * 100 : 0,
      color: SECTOR_COLORS[d.sector] ?? "#71717a",
    }));
  }, [data]);

  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-zinc-800 text-sm text-zinc-500">
        Sin sectores para mostrar.
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.sector} className="grid grid-cols-[minmax(140px,180px)_1fr_auto] items-center gap-3">
          <span className="truncate text-sm text-zinc-300">{r.sector}</span>
          <div className="h-7 rounded-md bg-zinc-800/40">
            <div
              className="flex h-full items-center justify-end rounded-md px-2 transition-all"
              style={{
                width: `${Math.max(r.barWidth, 4)}%`,
                background: `linear-gradient(90deg, ${r.color}AA, ${r.color})`,
                boxShadow: `0 0 14px ${r.color}33`,
              }}
              title={`${r.sector} · ${formatMoney(currency === "ARS" ? r.valueArs : r.valueUsd, currency)}`}
            />
          </div>
          <span className="w-24 text-right text-sm font-medium tabular-nums text-zinc-200">
            {formatPercent(r.percent, 1)}
          </span>
        </li>
      ))}
    </ul>
  );
}
