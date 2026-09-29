"use client";

import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { formatSignedPercentOrEmpty, returnToneClass } from "@/components/rendimientos/chart-utils";
import type { EvolutionMover } from "@/lib/dashboard/evolution";
import { cn } from "@/lib/utils";
import { formatSignedMoney, type ViewCurrency } from "./format";

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
  const allMovers = [...gainers, ...losers];
  const hasStaleMarker = allMovers.some((mover) => mover.priceIsStale);
  const hasLiveMarker = allMovers.some((mover) => mover.priceIsLive);
  const hasFlowMarker = allMovers.some((mover) => mover.hadFlow);
  const showLegend = hasStaleMarker || hasLiveMarker || hasFlowMarker;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-zinc-100">Movimientos del día</h3>

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
            movers={gainers}
            currency={currency}
            emptyText="Nadie subió."
          />
          <MoverColumn
            title="Bajaron"
            icon={<TrendingDown className="h-3.5 w-3.5" />}
            accent="rose"
            movers={losers}
            currency={currency}
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
  emptyText,
}: {
  title: string;
  icon: ReactNode;
  accent: "emerald" | "rose";
  movers: EvolutionMover[];
  currency: ViewCurrency;
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
            return (
              <li key={mover.ticker} className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-xs font-medium text-zinc-200">
                  {mover.ticker}
                  {mover.priceIsStale ? <span className="text-amber-400/80">*</span> : null}
                  {mover.priceIsLive ? <span className="text-emerald-400/80">•</span> : null}
                  {mover.hadFlow ? <span className="text-teal-400/80">°</span> : null}
                </span>
                <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-[11px] tabular-nums">
                  <span className={returnToneClass(pnl)}>
                    {formatSignedMoney(pnl, currency, { compact: true })}
                  </span>
                  <span className="text-zinc-500">{formatSignedPercentOrEmpty(mover.pricePercent)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
