"use client";

import { ChartCard } from "@/components/dashboard/chart-card";
import {
  EMPTY_VALUE,
  formatSignedPercentValue,
} from "@/components/rendimientos/chart-utils";
import type { ViewCurrency } from "@/lib/rendimientos/types";
import type { MonthlyChartRow } from "@/lib/rendimientos/view";

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Intensidad máxima del color a este valor absoluto de rendimiento (%). */
const SATURATION_AT = 8;

/**
 * Mapa de calor año × mes. Sirve para leer estacionalidad y rachas de un saque, algo
 * que la serie temporal no muestra.
 *
 * Una celda sin rendimiento medible queda gris con `—`, nunca en el color del cero:
 * "no lo puedo medir" y "no varió" son afirmaciones distintas.
 */
export function MonthlyReturns({
  data,
  currency,
}: {
  data: MonthlyChartRow[];
  currency: ViewCurrency;
}) {
  const byKey = new Map(data.map((row) => [row.month, row.monthlyReturn]));
  const years = [...new Set(data.map((row) => Number(row.month.slice(0, 4))))].sort(
    (a, b) => a - b
  );

  return (
    <ChartCard
      title="Mapa de rendimientos"
      description={`Rendimiento de cada mes por año (${currency}).`}
    >
      {years.length === 0 ? (
        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-center text-sm text-zinc-500">
          Todavía no hay meses con rendimiento calculable.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[64px_repeat(12,minmax(0,1fr))] gap-1.5 text-center text-[11px] text-zinc-500">
              <span />
              {MONTHS.map((month) => (
                <span key={month}>{month}</span>
              ))}
              {years.map((year) => (
                <div key={year} className="contents">
                  <span className="self-center text-left font-medium text-zinc-400">{year}</span>
                  {MONTHS.map((_, monthIndex) => {
                    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
                    return (
                      <ReturnCell
                        key={key}
                        // `undefined` = el mes no está en el período; `null` = está pero
                        // no es medible. Ambos se dibujan igual, pero el título difiere.
                        value={byKey.has(key) ? (byKey.get(key) ?? null) : undefined}
                      />
                    );
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

function ReturnCell({ value }: { value: number | null | undefined }) {
  const hasValue = typeof value === "number";
  const intensity = hasValue ? Math.min(Math.abs(value) / SATURATION_AT, 1) : 0;
  const backgroundColor = !hasValue
    ? "#18181b"
    : value >= 0
      ? `rgba(16, 185, 129, ${0.12 + intensity * 0.55})`
      : `rgba(244, 63, 94, ${0.12 + intensity * 0.55})`;

  const title = hasValue
    ? formatSignedPercentValue(value)
    : value === null
      ? "Sin rendimiento medible"
      : "Fuera del período";

  return (
    <span
      title={title}
      className="flex min-h-9 items-center justify-center rounded-md border border-zinc-800/70 px-1 tabular-nums text-[11px] text-zinc-200"
      style={{ backgroundColor }}
    >
      {hasValue ? formatSignedPercentValue(value) : EMPTY_VALUE}
    </span>
  );
}
