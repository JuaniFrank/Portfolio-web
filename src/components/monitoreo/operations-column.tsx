import type * as React from "react";
import { Calculator } from "lucide-react";
import { cn } from "@/lib/utils";

export type ColumnTab = "trades" | "sim";

interface OperationsColumnProps {
  tab: ColumnTab;
  onTabChange: (tab: ColumnTab) => void;
  tradesCount: number;
  /** Tabs (and the footer button's role) only appear once the simulator was opened */
  simStarted: boolean;
  onStartSimulation: () => void;
  /** Whether a valid simulation is currently drawn on the chart (dot on the Simular tab) */
  simulating: boolean;
  children: React.ReactNode;
}

const tabClass = (active: boolean) =>
  cn(
    "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
    active ? "border-sky-500 text-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-300"
  );

/**
 * Right column of /activos: the trades list or the simulator share one frame. The header (tabs)
 * and the footer button stay put while the body scrolls, so the column never outgrows the chart.
 */
export function OperationsColumn({
  tab,
  onTabChange,
  tradesCount,
  simStarted,
  onStartSimulation,
  simulating,
  children,
}: OperationsColumnProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/70">
      {simStarted ? (
        <div
          role="tablist"
          aria-label="Operaciones y simulador"
          className="flex border-b border-zinc-800/60"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "trades"}
            onClick={() => onTabChange("trades")}
            className={tabClass(tab === "trades")}
          >
            Operaciones
            <span className="rounded-full bg-zinc-800 px-1.5 text-[10px] font-medium text-zinc-400">
              {tradesCount}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "sim"}
            onClick={() => onTabChange("sim")}
            className={tabClass(tab === "sim")}
          >
            Simular
            {simulating && (
              <span
                className="h-1.5 w-1.5 rounded-full bg-sky-400"
                aria-label="Simulación activa"
              />
            )}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between border-b border-zinc-800/60 px-3 py-2.5">
          <h3 className="text-sm font-semibold text-zinc-100">Tus operaciones</h3>
          <span className="text-xs text-zinc-500">{tradesCount}</span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

      {tab === "trades" && (
        <div className="border-t border-zinc-800/60 p-2">
          <button
            type="button"
            onClick={onStartSimulation}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-sky-900/60 bg-sky-950/40 px-3 py-2 text-xs font-medium text-sky-200 transition-colors hover:bg-sky-950/70"
          >
            <Calculator className="h-4 w-4" aria-hidden />
            Simular operación
          </button>
        </div>
      )}
    </div>
  );
}
