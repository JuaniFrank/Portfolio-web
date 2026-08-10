"use client";

import { EMPTY_VALUE, TOOLTIP_CLASS, formatMonthTooltip } from "@/components/rendimientos/chart-utils";

export type TooltipEntry = {
  label: string;
  color: string;
  /** Ya formateado. `null` se renderiza como "—", nunca como cero. */
  value: string | null;
};

/**
 * Tooltip base de los charts mensuales.
 *
 * Recharts pasa un `payload` genérico; cada chart lo traduce a `TooltipEntry[]` y este
 * componente se ocupa del formato. Así el estilo del tooltip se define una sola vez.
 */
export function MonthTooltip({
  month,
  entries,
  footer,
}: {
  month: string | number | undefined;
  entries: TooltipEntry[];
  footer?: string;
}) {
  return (
    <div className={TOOLTIP_CLASS}>
      <p className="mb-2 font-medium text-zinc-300">
        {typeof month === "string" ? formatMonthTooltip(month) : month}
      </p>
      {entries.map((entry) => (
        <div key={entry.label} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            {entry.label}
          </span>
          <span className="font-medium tabular-nums text-zinc-100">
            {entry.value ?? EMPTY_VALUE}
          </span>
        </div>
      ))}
      {footer ? <p className="mt-2 border-t border-zinc-800 pt-2 text-zinc-500">{footer}</p> : null}
    </div>
  );
}

/** Placeholder cuando un chart no tiene suficientes puntos. */
export function ChartPlaceholder({ text, height }: { text: string; height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-lg border border-dashed border-zinc-800 px-4 text-center text-sm text-zinc-500"
      style={{ height }}
    >
      {text}
    </div>
  );
}
