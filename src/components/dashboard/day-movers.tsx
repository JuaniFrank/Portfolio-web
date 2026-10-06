"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, TrendingDown, TrendingUp } from "lucide-react";
import { formatSignedPercentOrEmpty, returnToneClass } from "@/components/rendimientos/chart-utils";
import {
  sortEvolutionMovers,
  type EvolutionMover,
  type MoverSortMode,
} from "@/lib/dashboard/evolution";
import { cn } from "@/lib/utils";
import { formatSignedMoney, type ViewCurrency } from "./format";

/** Filas visibles por columna antes de desplegar "Ver todo". */
const COLLAPSED_COUNT = 5;

type Props = {
  gainers: EvolutionMover[];
  losers: EvolutionMover[];
  currency: ViewCurrency;
};

/**
 * Ganadores/perdedores del último cierre, con las mismas marcas que el tooltip del
 * gráfico de evolución (`*` arrastrado, `•` precio en vivo, `°` hubo operación): son el
 * mismo dato (`EvolutionMover`), así que tienen que leerse igual en los dos lugares.
 */
export function DayMovers({ gainers, losers, currency }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [sortMode, setSortMode] = useState<MoverSortMode>("nominal");

  const allMovers = [...gainers, ...losers];
  const hasStaleMarker = allMovers.some((mover) => mover.priceIsStale);
  const hasLiveMarker = allMovers.some((mover) => mover.priceIsLive);
  const hasFlowMarker = allMovers.some((mover) => mover.hadFlow);
  const showLegend = hasStaleMarker || hasLiveMarker || hasFlowMarker;

  const sortedGainers = useMemo(
    () => sortEvolutionMovers(gainers, "gainers", sortMode, currency),
    [gainers, sortMode, currency]
  );
  const sortedLosers = useMemo(
    () => sortEvolutionMovers(losers, "losers", sortMode, currency),
    [losers, sortMode, currency]
  );

  const canExpand = gainers.length > COLLAPSED_COUNT || losers.length > COLLAPSED_COUNT;
  const visibleGainers = expanded ? sortedGainers : sortedGainers.slice(0, COLLAPSED_COUNT);
  const visibleLosers = expanded ? sortedLosers : sortedLosers.slice(0, COLLAPSED_COUNT);
  const totalMovers = gainers.length + losers.length;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">Movimientos del día</h3>

        {allMovers.length > 0 ? (
          <div className="flex items-center gap-3">
            <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-900/80 p-0.5">
              <button
                type="button"
                onClick={() => setSortMode("nominal")}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                  sortMode === "nominal"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                Nominal
              </button>
              <button
                type="button"
                onClick={() => setSortMode("percent")}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                  sortMode === "percent"
                    ? "bg-zinc-800 text-zinc-100 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                Porcentual
              </button>
            </div>

            {canExpand ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="flex items-center gap-1 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-100"
              >
                <span>{expanded ? "Ver menos" : `Ver todo (${totalMovers})`}</span>
                {expanded ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {allMovers.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-500">
          Ninguna posición se movió en el último cierre.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <MoverColumn
            title="Subieron"
            icon={<TrendingUp className="h-3.5 w-3.5" />}
            accent="emerald"
            movers={visibleGainers}
            currency={currency}
            sortMode={sortMode}
            emptyText="Nadie subió."
          />
          <MoverColumn
            title="Bajaron"
            icon={<TrendingDown className="h-3.5 w-3.5" />}
            accent="rose"
            movers={visibleLosers}
            currency={currency}
            sortMode={sortMode}
            emptyText="Nadie bajó."
          />
        </div>
      )}

      {showLegend ? (
        <p className="mt-3 flex flex-wrap gap-x-3 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          {hasStaleMarker ? (
            <span>
              <span className="text-amber-400/80">*</span> sin cierre propio
            </span>
          ) : null}
          {hasLiveMarker ? (
            <span>
              <span className="text-emerald-400/80">•</span> precio en vivo
            </span>
          ) : null}
          {hasFlowMarker ? (
            <span>
              <span className="text-teal-400/80">°</span> operaste en el período
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function MoverColumn({
  title,
  icon,
  accent,
  movers,
  currency,
  sortMode,
  emptyText,
}: {
  title: string;
  icon: ReactNode;
  accent: "emerald" | "rose";
  movers: EvolutionMover[];
  currency: ViewCurrency;
  sortMode: MoverSortMode;
  emptyText: string;
}) {
  const accentClass = accent === "emerald" ? "text-emerald-400" : "text-rose-400";

  return (
    <div className="min-w-0">
      <p
        className={cn(
          "mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide",
          accentClass
        )}
      >
        {icon}
        {title}
      </p>
      {movers.length === 0 ? (
        <p className="text-[11px] text-zinc-600">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {movers.map((mover) => {
            const pnl = currency === "ARS" ? mover.pnlArs : mover.pnlUsd;
            const moneyTone = returnToneClass(pnl);
            const percentTone = returnToneClass(mover.pricePercent);

            return (
              <li key={mover.ticker} className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium text-zinc-200">
                  {mover.ticker}
                  {mover.priceIsStale ? <span className="text-amber-400/80">*</span> : null}
                  {mover.priceIsLive ? <span className="text-emerald-400/80">•</span> : null}
                  {mover.hadFlow ? <span className="text-teal-400/80">°</span> : null}
                </span>
                <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-[11px] tabular-nums">
                  <span
                    className={cn(
                      sortMode === "nominal" ? cn("font-medium", moneyTone) : "text-zinc-500"
                    )}
                  >
                    {formatSignedMoney(pnl, currency, { compact: true })}
                  </span>
                  <span
                    className={cn(
                      sortMode === "percent" ? cn("font-medium", percentTone) : "text-zinc-500"
                    )}
                  >
                    {formatSignedPercentOrEmpty(mover.pricePercent)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
