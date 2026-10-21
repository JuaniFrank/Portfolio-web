"use client";

import * as React from "react";
import type { PortfolioEvolution } from "@/lib/dashboard/evolution";
import {
  buildViewRows,
  rebaseForRange,
  selectTickers,
  summarizeRange,
  tradesForSelection,
  type InstrumentTypeSet,
  type TickerSet,
} from "@/lib/dashboard/evolution-view";
import { estimatedPricesCutoff, round2, type ViewMode } from "@/lib/dashboard/evolution-chart";
import {
  DEFAULT_TIME_RANGE,
  clampToSeries,
  sliceByRange,
  type TimeRange,
} from "@/lib/dashboard/time-range";
import type { Granularity } from "@/lib/rendimientos/timeline";
import type { ViewCurrency } from "../format";
import { ASSET_TYPE_ORDER, type ChartRow } from "./chart-model";

/**
 * Estado de los controles y datos derivados del gráfico de evolución: filtros, rango,
 * modo y las filas ya filtradas/rebaseadas que consume el chart. Todos los hooks viven
 * acá (antes del early return del componente) para conservar el orden original.
 */
export function useEvolutionChart(
  evolution: PortfolioEvolution,
  currency: ViewCurrency,
  initialRange: TimeRange | undefined
) {
  const [granularity, setGranularity] = React.useState<Granularity>("daily");
  const [range, setRange] = React.useState<TimeRange>(initialRange ?? DEFAULT_TIME_RANGE);
  const [typeFilter, setTypeFilter] = React.useState<InstrumentTypeSet>("all");
  const [tickerFilter, setTickerFilter] = React.useState<TickerSet>("all");
  const [mode, setMode] = React.useState<ViewMode>("value");
  const [showContributions, setShowContributions] = React.useState(false);
  const [showTrades, setShowTrades] = React.useState(false);

  const series = evolution.series[granularity];

  // La referencia de los presets es el último cierre, no hoy: ver `time-range.ts`.
  const referenceDay = evolution.lastDate ?? series.at(-1)?.date ?? null;

  const availableTypes = React.useMemo(
    () => ASSET_TYPE_ORDER.filter((type) => evolution.instruments.some((i) => i.type === type)),
    [evolution.instruments]
  );

  const selection = React.useMemo(
    () => selectTickers(evolution.instruments, { types: typeFilter, tickers: tickerFilter }),
    [evolution.instruments, typeFilter, tickerFilter]
  );

  // La selección cubre TODOS los instrumentos de la serie (no solo del punto que se está
  // mirando): es lo que habilita sumar la renta sin atribuir del punto en `buildViewRows`
  // sin inventarle un dueño.
  const isFullSelection = selection.size === evolution.instruments.length;

  // Filas de la selección sobre la serie COMPLETA: `invested`/`cumulativeReturn` se
  // acumulan desde el primer punto real, así que un aporte anterior al recorte de rango
  // no desaparece del acumulado (ver `evolution-view.ts`).
  const viewRows = React.useMemo(
    () => buildViewRows(series, selection, currency, isFullSelection),
    [series, selection, currency, isFullSelection]
  );

  const visiblePoints = React.useMemo(
    () => (referenceDay ? sliceByRange(series, range, referenceDay) : series),
    [series, range, referenceDay]
  );

  const visibleViewRows = React.useMemo(
    () => (referenceDay ? sliceByRange(viewRows, range, referenceDay) : viewRows),
    [viewRows, range, referenceDay]
  );

  // En modo % arranca en 0 en el primer punto visible; en modo Resultado el número
  // sigue siendo el absoluto acumulado (ver `rebaseForRange`).
  const rebasedRows = React.useMemo(() => rebaseForRange(visibleViewRows), [visibleViewRows]);

  const summary = React.useMemo(() => summarizeRange(visibleViewRows), [visibleViewRows]);

  const pointsByDate = React.useMemo(
    () => new Map(visiblePoints.map((point) => [point.date, point])),
    [visiblePoints]
  );

  const visibleDates = React.useMemo(() => rebasedRows.map((row) => row.date), [rebasedRows]);

  const tradeMarkers = React.useMemo(
    () => (showTrades ? tradesForSelection(evolution.trades, selection, visibleDates, currency) : []),
    [showTrades, evolution.trades, selection, visibleDates, currency]
  );

  const markersByDate = React.useMemo(
    () => new Map(tradeMarkers.map((marker) => [marker.date, marker])),
    [tradeMarkers]
  );

  const rows = React.useMemo<ChartRow[]>(
    () =>
      rebasedRows.map((view, index) => {
        const point = pointsByDate.get(view.date) ?? null;
        const previous = rebasedRows[index - 1];
        return {
          date: view.date,
          chartValue:
            mode === "value" ? view.value : mode === "result" ? view.result : view.cumulativeReturn ?? 0,
          view,
          periodChange: previous ? round2(view.result - previous.result) : 0,
          gainers: point ? point.gainers.filter((mover) => selection.has(mover.ticker)) : [],
          losers: point ? point.losers.filter((mover) => selection.has(mover.ticker)) : [],
          staleTickers: point ? point.staleTickers.filter((ticker) => selection.has(ticker)) : [],
          trade: markersByDate.get(view.date) ?? null,
        };
      }),
    [rebasedRows, mode, pointsByDate, selection, markersByDate]
  );

  // Los extremos del calendario salen de la granularidad más fina: es el rango de fechas
  // con dato, independientemente de cómo esté agrupada la vista.
  const bounds = React.useMemo(() => clampToSeries(evolution.series.daily), [evolution]);

  const estimatedCutoff = React.useMemo(
    () => estimatedPricesCutoff(evolution.series.daily),
    [evolution]
  );

  const selectionKey = React.useMemo(() => [...selection].sort().join(","), [selection]);
  const hasSelection = selection.size > 0;

  // Cambiar el tipo de activo sin resetear el ticker podía dejar la intersección vacía
  // en silencio (ej. un ticker de CEDEAR elegido, después se filtra a "ONs"): ningún
  // ticker de ese tipo estaría seleccionado y el chart se apagaría sin explicación.
  const handleTypeFilterChange = React.useCallback((next: InstrumentTypeSet) => {
    setTypeFilter(next);
    setTickerFilter("all");
  }, []);

  return {
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
  };
}
