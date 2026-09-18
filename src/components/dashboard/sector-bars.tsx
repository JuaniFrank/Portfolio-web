"use client";

import { useMemo } from "react";
import type { DashboardHolding, SectorBar, SectorHoldingDetail } from "@/lib/dashboard/types";
import {
  SECTOR_COLORS,
  SECTOR_DESCRIPTIONS,
  formatMoney,
  formatPercent,
  type ViewCurrency,
} from "./format";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export { SECTOR_DESCRIPTIONS };

type Props = {
  data: SectorBar[];
  currency: ViewCurrency;
  holdings?: DashboardHolding[];
};

export function SectorBars({ data, currency, holdings }: Props) {
  const rows = useMemo(() => {
    if (data.length === 0) return [];
    const max = Math.max(...data.map((d) => Number(d.percent)));

    // Fallback si la data recibida no incluye desglose de holdings
    const fallbackHoldingsBySector = new Map<string, SectorHoldingDetail[]>();
    if (holdings && holdings.length > 0) {
      for (const d of data) {
        if (!d.holdings || d.holdings.length === 0) {
          const matching = holdings
            .filter((h) => h.sector === d.sector && Number(h.marketValueArs) > 0)
            .sort((a, b) => Number(b.marketValueArs) - Number(a.marketValueArs));
          const totalSectorVal = matching.reduce(
            (acc, h) => acc + Number(h.marketValueArs),
            0
          );
          fallbackHoldingsBySector.set(
            d.sector,
            matching.map((h) => ({
              ticker: h.ticker,
              name: h.instrumentName,
              valueArs: h.marketValueArs,
              valueUsd: h.marketValueUsd,
              percent: h.weightPercent,
              percentOfSector:
                totalSectorVal > 0
                  ? ((Number(h.marketValueArs) / totalSectorVal) * 100).toFixed(1)
                  : "0",
            }))
          );
        }
      }
    }

    return data.map((d) => {
      const description =
        SECTOR_DESCRIPTIONS[d.sector] ??
        SECTOR_DESCRIPTIONS[
          Object.keys(SECTOR_DESCRIPTIONS).find(
            (k) => k.toLowerCase() === d.sector.toLowerCase()
          ) ?? ""
        ];

      const resolvedHoldings =
        d.holdings && d.holdings.length > 0
          ? d.holdings
          : fallbackHoldingsBySector.get(d.sector) ?? [];

      return {
        ...d,
        barWidth: max > 0 ? (Number(d.percent) / max) * 100 : 0,
        color: SECTOR_COLORS[d.sector] ?? "#71717a",
        description,
        resolvedHoldings,
      };
    });
  }, [data, holdings]);

  if (rows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-zinc-800 text-sm text-zinc-500">
        Sin sectores para mostrar.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li
            key={r.sector}
            className="grid grid-cols-[minmax(140px,180px)_1fr_auto] items-center gap-3"
          >
            {/* Tooltip sobre el nombre del sector con su descripción */}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex max-w-full cursor-help items-center truncate">
                  <span className="truncate text-sm text-zinc-300 underline decoration-zinc-700/80 decoration-dotted underline-offset-4 transition-colors hover:text-zinc-100 hover:decoration-zinc-400">
                    {r.sector}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="start"
                className="max-w-xs space-y-1 p-3 text-xs shadow-xl"
              >
                <p className="font-semibold text-zinc-100">{r.sector}</p>
                <p className="leading-relaxed text-zinc-300">
                  {r.description ?? "Sin descripción disponible para este sector."}
                </p>
              </TooltipContent>
            </Tooltip>

            {/* Tooltip sobre la barra del sector mostrando las acciones que la componen */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="group/bar relative h-7 cursor-pointer rounded-md bg-zinc-800/40 p-0.5 transition-colors hover:bg-zinc-800/60">
                  <div
                    className="flex h-full items-center justify-end rounded-md px-2 transition-all group-hover/bar:brightness-110"
                    style={{
                      width: `${Math.max(r.barWidth, 4)}%`,
                      background: `linear-gradient(90deg, ${r.color}AA, ${r.color})`,
                      boxShadow: `0 0 14px ${r.color}33`,
                    }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                align="center"
                className="w-80 space-y-2.5 p-3 text-xs shadow-xl"
              >
                <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: r.color }}
                    />
                    <span className="truncate font-semibold text-zinc-100">
                      {r.sector}
                    </span>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <span className="font-semibold text-zinc-100">
                      {formatPercent(r.percent, 1)}
                    </span>
                    <span className="ml-1.5 text-[11px] text-zinc-400">
                      ({formatMoney(currency === "ARS" ? r.valueArs : r.valueUsd, currency)})
                    </span>
                  </div>
                </div>

                {r.resolvedHoldings.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium text-zinc-400">
                      Composición del sector ({r.resolvedHoldings.length}):
                    </p>
                    <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                      {r.resolvedHoldings.map((h) => (
                        <li
                          key={h.ticker}
                          className="flex items-center justify-between gap-2 border-b border-zinc-900/60 pb-1.5 text-xs last:border-none last:pb-0"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-zinc-100">
                                {h.ticker}
                              </span>
                              {h.name && (
                                <span
                                  className="max-w-[130px] truncate text-[11px] text-zinc-400"
                                  title={h.name}
                                >
                                  {h.name}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] tabular-nums text-zinc-400">
                              {formatMoney(
                                currency === "ARS" ? h.valueArs : h.valueUsd,
                                currency
                              )}
                            </div>
                          </div>
                          <div className="shrink-0 text-right tabular-nums">
                            <div className="font-semibold text-zinc-100">
                              {formatPercent(h.percent, 1)}
                            </div>
                            <div className="text-[10px] text-zinc-400">
                              {formatPercent(h.percentOfSector, 0)} del sector
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-zinc-400">Sin instrumentos registrados.</p>
                )}
              </TooltipContent>
            </Tooltip>

            {/* Porcentaje numérico */}
            <span className="w-24 text-right text-sm font-medium tabular-nums text-zinc-200">
              {formatPercent(r.percent, 1)}
            </span>
          </li>
        ))}
      </ul>
    </TooltipProvider>
  );
}
