"use client";

import * as React from "react";
import { ChartPlaceholder } from "@/components/rendimientos/chart-tooltip";
import type { PortfolioEvolution } from "@/lib/dashboard/evolution";
import type { ViewMode } from "@/lib/dashboard/evolution-chart";
import type { TimeRange } from "@/lib/dashboard/time-range";
import { TimeRangeSelector } from "./time-range-selector";
import { TickerSelector } from "./evolution/ticker-selector";
import { SummaryStrip } from "./evolution/summary-strip";
import { HEIGHT } from "./evolution/chart-model";
import {
  AssetTypeChips,
  GranularityToggle,
  ModeToggle,
  ToggleChip,
} from "./evolution/chart-controls";
import { Footnote } from "./evolution/footnote";
import { useEvolutionChart } from "./evolution/use-evolution-chart";
import { ZoomableAreaChart } from "./evolution/zoomable-area-chart";
import type { ViewCurrency } from "./format";

export type { ViewMode };

type Props = {
  evolution: PortfolioEvolution;
  currency: ViewCurrency;
  /** Rango inicial del selector. Por defecto `DEFAULT_TIME_RANGE` (Todo); el dashboard
   * lo arranca en 3M para enfocar el corto plazo sin perder el resto de la UI. */
  initialRange?: TimeRange;
};

export function PortfolioEvolutionChart({ evolution, currency, initialRange }: Props) {
  const {
    granularity,
    setGranularity,
    range,
    setRange,
    typeFilter,
    tickerFilter,
    setTickerFilter,
    mode,
    setMode,
    showContributions,
    setShowContributions,
    showTrades,
    setShowTrades,
    availableTypes,
    summary,
    rows,
    bounds,
    estimatedCutoff,
    selectionKey,
    hasSelection,
    handleTypeFilterChange,
  } = useEvolutionChart(evolution, currency, initialRange);

  if (!evolution.hasData) {
    return (
      <ChartPlaceholder
        text="Todavía no hay histórico para reconstruir. Se necesita al menos una compra de acciones, CEDEARs u ONs con precios de cierre cargados."
        height={HEIGHT}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <GranularityToggle value={granularity} onChange={setGranularity} />
        <TimeRangeSelector value={range} onChange={setRange} min={bounds.min} max={bounds.max} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <AssetTypeChips
          availableTypes={availableTypes}
          value={typeFilter}
          onChange={handleTypeFilterChange}
        />
        <TickerSelector
          instruments={evolution.instruments}
          typeFilter={typeFilter}
          value={tickerFilter}
          onChange={setTickerFilter}
        />

        <span className="mx-1 hidden h-4 w-px bg-zinc-800 sm:inline-block" aria-hidden />

        <ModeToggle value={mode} onChange={setMode} />
        {mode === "value" ? (
          <ToggleChip
            active={showContributions}
            onClick={() => setShowContributions((v) => !v)}
          >
            Aportes netos
          </ToggleChip>
        ) : null}
        <ToggleChip active={showTrades} onClick={() => setShowTrades((v) => !v)}>
          Operaciones
        </ToggleChip>
      </div>

      <SummaryStrip summary={summary} currency={currency} />

      {hasSelection && rows.length >= 2 ? (
        <ZoomableAreaChart
          rows={rows}
          currency={currency}
          mode={mode}
          showContributions={showContributions && mode === "value"}
          showTrades={showTrades}
          // Cambiar de granularidad, rango, selección o modo cambia lo que estás
          // mirando, así que el gráfico se reencuadra. Cambiar de moneda no: ahí
          // conservar el zoom es lo que uno espera.
          resetKey={`${granularity}|${range.preset}|${range.from ?? ""}|${range.to ?? ""}|${mode}|${selectionKey}`}
        />
      ) : (
        <ChartPlaceholder
          text={
            !hasSelection
              ? "Elegí al menos un ticker para ver el gráfico."
              : range.preset === "ALL"
                ? "Hace falta más de un cierre para dibujar una evolución."
                : "El rango elegido no tiene suficientes cierres. Probá uno más amplio."
          }
          height={HEIGHT}
        />
      )}

      <p className="text-[11px] text-zinc-500">
        Rueda para hacer zoom · arrastrá para desplazarte · doble clic en el eje para
        reencuadrar
      </p>

      <Footnote evolution={evolution} estimatedCutoff={estimatedCutoff} />
    </div>
  );
}
