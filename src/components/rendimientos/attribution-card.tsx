"use client";

import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { formatSignedMoney } from "@/components/dashboard/format";
import {
  attributeReturns,
  type AttributionGroupBy,
  type AttributionRow,
} from "@/lib/rendimientos/attribution";
import type { MonthlyPerformanceRow, ViewCurrency } from "@/lib/rendimientos/types";
import { cn } from "@/lib/utils";

type Props = {
  /** Meses ya recortados al período seleccionado (`sliceMonths`). */
  months: MonthlyPerformanceRow[];
  sectorByTicker: Record<string, string>;
  currency: ViewCurrency;
};

const GROUP_OPTIONS: Array<{ id: AttributionGroupBy; label: string }> = [
  { id: "ticker", label: "Por ticker" },
  { id: "sector", label: "Por sector" },
];

/**
 * "Atribución del período": cuánto empujó cada ticker/sector la ganancia del
 * período visible, con la renta y el residual de reconciliación aparte.
 *
 * Barras divergentes (positivo a la derecha, negativo a la izquierda de una
 * línea central) — sin librería de charts, el mismo patrón "div-based" que
 * el resto de las barras del dashboard.
 */
export function AttributionCard({ months, sectorByTicker, currency }: Props) {
  const [groupBy, setGroupBy] = useState<AttributionGroupBy>("ticker");

  const sectorOf = useMemo(
    () => (ticker: string) => sectorByTicker[ticker] ?? "Sin clasificar",
    [sectorByTicker]
  );

  const result = useMemo(
    () => attributeReturns(months, groupBy, currency, sectorOf),
    [months, groupBy, currency, sectorOf]
  );

  const maxAbs = Math.max(1, ...result.rows.map((row) => Math.abs(row.amount)));

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <BarChart3 className="h-4 w-4 text-teal-400" />
          Atribución del período
        </h3>
        <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-950/60 p-1">
          {GROUP_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setGroupBy(option.id)}
              aria-pressed={groupBy === option.id}
              className={cn(
                "rounded px-2.5 py-1.5 text-xs transition-colors",
                groupBy === option.id
                  ? "bg-teal-500/20 font-medium text-teal-300"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {result.rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-500">
          No hay datos para atribuir en este período.
        </p>
      ) : (
        <div className="space-y-1.5">
          {result.rows.map((row) => (
            <AttributionBarRow key={row.key} row={row} currency={currency} maxAbs={maxAbs} />
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-zinc-800 pt-2">
        <span className="text-xs font-medium text-zinc-400">Total</span>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            result.total >= 0 ? "text-emerald-400" : "text-rose-400"
          )}
        >
          {formatSignedMoney(result.total, currency)}
        </span>
      </div>
    </div>
  );
}

function AttributionBarRow({
  row,
  currency,
  maxAbs,
}: {
  row: AttributionRow;
  currency: ViewCurrency;
  maxAbs: number;
}) {
  const isPositive = row.amount >= 0;
  const widthPercent = (Math.abs(row.amount) / maxAbs) * 50;

  // Los grupos (ticker/sector) se colorean por signo; la renta y la
  // reconciliación son categorías propias, no un resultado positivo/negativo
  // en sí mismas, así que llevan un color neutro fijo.
  const barColor =
    row.kind === "income"
      ? "bg-teal-500/70"
      : row.kind === "reconciliation"
        ? "bg-amber-500/70"
        : isPositive
          ? "bg-emerald-500/70"
          : "bg-rose-500/70";

  const amountColor =
    row.kind === "income"
      ? "text-teal-400"
      : row.kind === "reconciliation"
        ? "text-amber-400"
        : isPositive
          ? "text-emerald-400"
          : "text-rose-400";

  return (
    <div className="grid grid-cols-[minmax(0,96px)_1fr_minmax(0,110px)] items-center gap-2">
      <span
        className={cn(
          "min-w-0 truncate text-xs",
          row.kind === "group" ? "font-medium text-zinc-200" : "text-zinc-400"
        )}
        title={row.label}
      >
        {row.label}
      </span>

      <div className="relative h-4">
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-700" />
        {isPositive ? (
          <div
            className={cn("absolute inset-y-0 left-1/2 rounded-r-sm", barColor)}
            style={{ width: `${widthPercent}%` }}
          />
        ) : (
          <div
            className={cn("absolute inset-y-0 right-1/2 rounded-l-sm", barColor)}
            style={{ width: `${widthPercent}%` }}
          />
        )}
      </div>

      <span className={cn("shrink-0 whitespace-nowrap text-right text-xs tabular-nums", amountColor)}>
        {formatSignedMoney(row.amount, currency, { compact: true })}
      </span>
    </div>
  );
}
