"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import {
  AreaSeries,
  ColorType,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import {
  EMPTY_VALUE,
  SERIES_COLORS,
  TOOLTIP_CLASS,
  formatDateLong,
  formatSignedPercentOrEmpty,
  returnToneClass,
} from "@/components/rendimientos/chart-utils";
import { ChartPlaceholder } from "@/components/rendimientos/chart-tooltip";
import type {
  EvolutionInstrument,
  EvolutionMover,
  EvolutionPoint,
  PortfolioEvolution,
} from "@/lib/dashboard/evolution";
import {
  buildViewRows,
  rebaseForRange,
  selectTickers,
  summarizeRange,
  tradesForSelection,
  type EvolutionTradeMarker,
  type InstrumentTypeSet,
  type TickerSet,
  type ViewRow,
} from "@/lib/dashboard/evolution-view";
import {
  DEFAULT_TIME_RANGE,
  clampToSeries,
  sliceByRange,
  type TimeRange,
} from "@/lib/dashboard/time-range";
import { GRANULARITIES, type Granularity } from "@/lib/rendimientos/timeline";
import { TimeRangeSelector } from "./time-range-selector";
import { TickerSelector } from "./evolution/ticker-selector";
import { SummaryStrip } from "./evolution/summary-strip";
import { cn } from "@/lib/utils";
import { formatMoney, type ViewCurrency } from "./format";

const HEIGHT = 340;

/** Ancho del tooltip flotante. Fijo para poder decidir de qué lado del cursor va. */
const TOOLTIP_WIDTH = 380;
const CURSOR_OFFSET = 16;

const ASSET_TYPE_ORDER: EvolutionInstrument["type"][] = ["STOCK_AR", "CEDEAR", "ON"];
const ASSET_TYPE_LABELS: Record<EvolutionInstrument["type"], string> = {
  STOCK_AR: "Acciones",
  CEDEAR: "CEDEARs",
  ON: "ONs",
};

export type ViewMode = "value" | "result" | "percent";

const MODE_OPTIONS: Array<{ id: ViewMode; label: string }> = [
  { id: "value", label: "Valor" },
  { id: "result", label: "Resultado" },
  { id: "percent", label: "Rendimiento %" },
];

type Props = {
  evolution: PortfolioEvolution;
  currency: ViewCurrency;
};

/** Fila del chart: el valor a graficar según el modo, más todo lo que necesita el
 * tooltip — ya filtrado a la selección vigente. */
type ChartRow = {
  date: string;
  chartValue: number;
  view: ViewRow;
  /** `value(t) - value(t-1) - flujo(t)`, o 0 en el primer punto: mismo criterio que
   * `changeArs` en `evolution.ts`, aplicado a la selección. */
  periodChange: number;
  gainers: EvolutionMover[];
  losers: EvolutionMover[];
  staleTickers: string[];
  trade: EvolutionTradeMarker | null;
};

type Hovered = { row: ChartRow; x: number; y: number };

export function PortfolioEvolutionChart({ evolution, currency }: Props) {
  const [granularity, setGranularity] = React.useState<Granularity>("daily");
  const [range, setRange] = React.useState<TimeRange>(DEFAULT_TIME_RANGE);
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

/**
 * El gráfico con zoom. Usa `lightweight-charts` en vez de recharts por una razón
 * concreta: el zoom con rueda, el arrastre y el reescalado automático de los ejes vienen
 * de fábrica. En recharts habría que reimplementar los tres a mano, y el eje Y no se
 * reajustaría al tramo visible sin recalcular el dominio en cada gesto.
 *
 * Sigue el mismo patrón de refs, `ResizeObserver` y limpieza al desmontar que el resto
 * de los charts de `lightweight-charts`/`klinecharts` del repo.
 */
function ZoomableAreaChart({
  rows,
  currency,
  mode,
  showContributions,
  showTrades,
  resetKey,
}: {
  rows: ChartRow[];
  currency: ViewCurrency;
  mode: ViewMode;
  /** Ya resuelto por el caller: solo se pide en modo Valor. */
  showContributions: boolean;
  showTrades: boolean;
  /** Cambia cuando la vista pasa a significar otra cosa y hay que reencuadrar. */
  resetKey: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const seriesRef = React.useRef<ISeriesApi<"Area"> | null>(null);
  const contributionsSeriesRef = React.useRef<ISeriesApi<"Line"> | null>(null);
  const markersPluginRef = React.useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const [hovered, setHovered] = React.useState<Hovered | null>(null);
  const [isZoomed, setIsZoomed] = React.useState(false);

  const rowsByDate = React.useMemo(
    () => new Map(rows.map((row) => [row.date, row])),
    [rows]
  );

  // El callback del crosshair se suscribe una sola vez, así que lee los datos actuales
  // desde refs en vez de re-suscribirse en cada cambio de moneda, modo o selección.
  const rowsByDateRef = React.useRef(rowsByDate);
  const rowCountRef = React.useRef(rows.length);

  React.useEffect(() => {
    rowsByDateRef.current = rowsByDate;
    rowCountRef.current = rows.length;
  }, [rowsByDate, rows.length]);

  // --- Creación del chart: una sola vez por montaje ---
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
        fontSize: 11,
        fontFamily: "inherit",
      },
      grid: {
        vertLines: { color: "#27272a", style: LineStyle.Dotted },
        horzLines: { color: "#27272a", style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: "#27272a",
        // Es lo que hace que el eje Y siga al zoom: reescala al tramo visible en vez de
        // quedarse con el mínimo y máximo de toda la serie.
        autoScale: true,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        borderColor: "#27272a",
        // Sin esto se puede arrastrar la serie hacia el vacío y perderla de vista.
        fixLeftEdge: true,
        fixRightEdge: true,
        rightOffset: 0,
        minBarSpacing: 0.5,
      },
      crosshair: {
        vertLine: { color: "#52525b", width: 1, style: LineStyle.Dashed, labelVisible: true },
        horzLine: { color: "#52525b", width: 1, style: LineStyle.Dashed, labelVisible: true },
      },
      // Rueda para zoom, arrastre para desplazar, pinch en touch: el gesto de TradingView.
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: false },
        axisDoubleClickReset: { time: true, price: true },
      },
    });

    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: SERIES_COLORS.portfolio,
      topColor: "rgba(99, 102, 241, 0.35)",
      bottomColor: "rgba(99, 102, 241, 0)",
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: "#09090b",
      crosshairMarkerBackgroundColor: SERIES_COLORS.portfolio,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    seriesRef.current = series;

    // Aportes netos: línea punteada y más apagada, se prende solo en modo Valor.
    const contributionsSeries = chart.addSeries(LineSeries, {
      color: SERIES_COLORS.contributions,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      visible: false,
    });
    contributionsSeriesRef.current = contributionsSeries;

    markersPluginRef.current = createSeriesMarkers<Time>(series, []);

    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      const date = typeof param.time === "string" ? param.time : null;
      if (!date || !param.point) {
        setHovered(null);
        return;
      }
      const row = rowsByDateRef.current.get(date);
      if (!row) {
        setHovered(null);
        return;
      }
      setHovered({ row, x: param.point.x, y: param.point.y });
    });

    // Habilita el botón de reset solo cuando hay algo que resetear.
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      const total = rowCountRef.current;
      setIsZoomed(total > 1 && range.to - range.from < (total - 1) * 0.98);
    });

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          chart.applyOptions({ width: entry.contentRect.width });
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      contributionsSeriesRef.current = null;
      markersPluginRef.current = null;
    };
  }, []);

  // --- Datos: se reemplazan sin recrear el chart, para no perder el zoom ---
  const previousResetKey = React.useRef(resetKey);
  React.useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;

    series.setData(rows.map((row) => ({ time: row.date as Time, value: row.chartValue })));

    const contributionsSeries = contributionsSeriesRef.current;
    if (contributionsSeries) {
      contributionsSeries.applyOptions({ visible: showContributions });
      if (showContributions) {
        contributionsSeries.setData(
          rows.map((row) => ({ time: row.date as Time, value: row.view.invested }))
        );
      }
    }

    markersPluginRef.current?.setMarkers(
      showTrades ? rows.flatMap((row) => (row.trade ? [tradeToSeriesMarker(row.trade)] : [])) : []
    );

    if (previousResetKey.current !== resetKey) {
      previousResetKey.current = resetKey;
      chart.timeScale().fitContent();
      setIsZoomed(false);
    }
  }, [rows, resetKey, showContributions, showTrades]);

  // Encuadre inicial, una vez que la primera tanda de datos ya entró.
  React.useEffect(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  // --- Formato del eje según moneda y modo, sin recrear el chart ---
  React.useEffect(() => {
    chartRef.current?.applyOptions({
      localization: {
        locale: "es-AR",
        priceFormatter: (price: number) => formatAxisValue(price, currency, mode),
      },
    });
  }, [currency, mode]);

  const resetZoom = () => {
    chartRef.current?.timeScale().fitContent();
    setIsZoomed(false);
  };

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="w-full"
        style={{ height: HEIGHT }}
        // El tooltip se apaga al salir: si no, queda pegado el último punto visitado.
        onMouseLeave={() => setHovered(null)}
      />

      {isZoomed ? (
        <button
          type="button"
          onClick={resetZoom}
          className="absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[11px] text-zinc-300 backdrop-blur transition-colors hover:border-zinc-600 hover:text-zinc-100"
        >
          <RotateCcw className="h-3 w-3" />
          Ver todo
        </button>
      ) : null}

      {hovered ? (
        <FloatingTooltip hovered={hovered} currency={currency} mode={mode} container={containerRef} />
      ) : null}
    </div>
  );
}

function tradeToSeriesMarker(marker: EvolutionTradeMarker): SeriesMarker<Time> {
  if (marker.side === "buy") {
    return { time: marker.date as Time, position: "belowBar", color: "#10b981", shape: "arrowUp" };
  }
  if (marker.side === "sell") {
    return { time: marker.date as Time, position: "aboveBar", color: "#f43f5e", shape: "arrowDown" };
  }
  return { time: marker.date as Time, position: "aboveBar", color: "#f59e0b", shape: "circle" };
}

/**
 * Tooltip flotante junto al cursor.
 *
 * `lightweight-charts` no dibuja tooltips: da la posición del crosshair y el resto es
 * HTML. Se posiciona a mano y se voltea de lado cuando no entra a la derecha, para que
 * el detalle no se corte al hacer hover sobre los últimos cierres.
 */
function FloatingTooltip({
  hovered,
  currency,
  mode,
  container,
}: {
  hovered: Hovered;
  currency: ViewCurrency;
  mode: ViewMode;
  container: React.RefObject<HTMLDivElement | null>;
}) {
  const width = container.current?.clientWidth ?? 0;
  // En pantallas angostas el tooltip nunca es más ancho que el gráfico.
  const tooltipWidth = width > 0 ? Math.min(TOOLTIP_WIDTH, width) : TOOLTIP_WIDTH;
  const flipToLeft = hovered.x + CURSOR_OFFSET + tooltipWidth > width;
  const left = flipToLeft
    ? Math.max(0, hovered.x - CURSOR_OFFSET - tooltipWidth)
    : hovered.x + CURSOR_OFFSET;

  // Se ancla al borde opuesto al cursor: con varias secciones el tooltip es alto y
  // seguir la vertical del mouse lo haría desbordar y tapar justo el punto que se está
  // mirando.
  const anchorToBottom = hovered.y < HEIGHT / 2;

  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{
        left,
        width: tooltipWidth,
        ...(anchorToBottom ? { bottom: 0 } : { top: 0 }),
      }}
    >
      <EvolutionTooltip row={hovered.row} currency={currency} mode={mode} />
    </div>
  );
}

function GranularityToggle({
  value,
  onChange,
}: {
  value: Granularity;
  onChange: (granularity: Granularity) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Granularidad"
      className="inline-flex shrink-0 items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs"
    >
      {GRANULARITIES.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={chipClass(value === option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function AssetTypeChips({
  availableTypes,
  value,
  onChange,
}: {
  availableTypes: EvolutionInstrument["type"][];
  value: InstrumentTypeSet;
  onChange: (next: InstrumentTypeSet) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Tipo de activo"
      className="inline-flex shrink-0 items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs"
    >
      <button
        type="button"
        aria-pressed={value === "all"}
        onClick={() => onChange("all")}
        className={chipClass(value === "all")}
      >
        Todo
      </button>
      {availableTypes.map((type) => (
        <button
          key={type}
          type="button"
          aria-pressed={value !== "all" && value.has(type)}
          onClick={() => onChange(new Set([type]))}
          className={chipClass(value !== "all" && value.has(type))}
        >
          {ASSET_TYPE_LABELS[type]}
        </button>
      ))}
    </div>
  );
}

function ModeToggle({ value, onChange }: { value: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div
      role="group"
      aria-label="Modo de vista"
      className="inline-flex shrink-0 items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs"
    >
      {MODE_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={chipClass(value === option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-teal-800/60 bg-teal-950 text-teal-300 shadow-sm"
          : "border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200"
      )}
    >
      {children}
    </button>
  );
}

function chipClass(active: boolean): string {
  return cn(
    "rounded-md px-2 py-1 font-medium transition-colors",
    active
      ? "border border-teal-800/60 bg-teal-950 text-teal-300 shadow-sm"
      : "border border-transparent text-zinc-400 hover:text-zinc-200"
  );
}

function EvolutionTooltip({
  row,
  currency,
  mode,
}: {
  row: ChartRow;
  currency: ViewCurrency;
  mode: ViewMode;
}) {
  const hasBase = row.view.periodReturn !== null;
  const allMovers = [...row.gainers, ...row.losers];
  const hasFlowMarker = allMovers.some((mover) => mover.hadFlow);
  const hasLiveMarker = allMovers.some((mover) => mover.priceIsLive);

  const secondaryLabel =
    mode === "percent" ? "Rendimiento acumulado" : mode === "result" ? "Resultado acumulado" : "Aportes acumulados";
  const secondaryValue =
    mode === "percent"
      ? formatSignedPercentOrEmpty(row.view.cumulativeReturn)
      : mode === "result"
        ? formatSignedMoney(row.view.result, currency)
        : formatMoney(row.view.invested, currency);
  const secondaryTone =
    mode === "value"
      ? "text-zinc-100"
      : returnToneClass(mode === "percent" ? row.view.cumulativeReturn : row.view.result);

  return (
    <div className={TOOLTIP_CLASS}>
      <p className="font-medium text-zinc-200">
        {formatDateLong(row.date)}
        {row.view.hasEstimatedPrices ? (
          <span className="ml-1.5 rounded bg-amber-950 px-1 py-0.5 text-[10px] font-normal text-amber-300">
            estimado
          </span>
        ) : null}
      </p>

      <div className="mt-2 flex items-baseline justify-between gap-6">
        <span className="text-zinc-400">Valor</span>
        <span className="font-medium tabular-nums text-zinc-100">
          {formatMoney(row.view.value, currency)}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-6">
        <span className="text-zinc-400">{secondaryLabel}</span>
        <span className={cn("font-medium tabular-nums", secondaryTone)}>{secondaryValue}</span>
      </div>

      <div className="flex items-baseline justify-between gap-6">
        <span className="text-zinc-400">Resultado del período</span>
        <span className={cn("font-medium tabular-nums", returnToneClass(hasBase ? row.periodChange : null))}>
          {hasBase ? formatSignedMoney(row.periodChange, currency) : EMPTY_VALUE}
          <span className="ml-1.5 text-[11px] text-zinc-500">
            {formatSignedPercentOrEmpty(row.view.periodReturn)}
          </span>
        </span>
      </div>

      {row.gainers.length > 0 || row.losers.length > 0 ? (
        <div className="mt-2 grid grid-cols-2 gap-x-4 border-t border-zinc-800 pt-2">
          <MoverColumn title="Ganaron" movers={row.gainers} currency={currency} />
          <MoverColumn title="Perdieron" movers={row.losers} currency={currency} />
        </div>
      ) : (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          {hasBase
            ? "Ninguna posición seleccionada se movió en el período."
            : "Primer cierre: no hay período anterior con qué comparar."}
        </p>
      )}

      {row.trade ? (
        <div className="mt-2 border-t border-zinc-800 pt-2">
          <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
            Operaciones ({row.trade.count})
          </p>
          <ul className="space-y-0.5">
            {row.trade.trades.map((trade, index) => (
              <li
                key={`${trade.ticker}-${index}`}
                className="flex items-baseline justify-between gap-2 text-[11px]"
              >
                <span className="text-zinc-300">
                  {trade.side === "buy" ? "Compra" : "Venta"} {trade.ticker} × {trade.quantity}
                </span>
                <span className="tabular-nums text-zinc-400">{formatMoney(trade.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasFlowMarker ? (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          <span className="text-teal-400/80">°</span> Operaste en el período: el resultado
          incluye el precio al que compraste o vendiste, así que puede no acompañar la
          variación del ticker.
        </p>
      ) : null}

      {hasLiveMarker ? (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-zinc-500">
          <span className="text-emerald-400/80">•</span> Precio en vivo: todavía no hay cierre
          del día, se reemplaza cuando corre el backfill.
        </p>
      ) : null}

      {row.staleTickers.length > 0 ? (
        <p className="mt-2 border-t border-zinc-800 pt-2 text-[11px] text-amber-300/80">
          <span className="text-amber-400/80">*</span> Sin cierre propio del período (
          {row.staleTickers.join(", ")}): valuado al último precio conocido.
        </p>
      ) : null}
    </div>
  );
}

function MoverColumn({
  title,
  movers,
  currency,
}: {
  title: string;
  movers: EvolutionMover[];
  currency: ViewCurrency;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">{title}</p>
      {movers.length === 0 ? (
        <p className="text-[11px] text-zinc-600">{EMPTY_VALUE}</p>
      ) : (
        <ul className="space-y-0.5">
          {movers.map((mover) => (
            <li
              key={mover.ticker}
              className="flex min-w-0 items-baseline justify-between gap-2 whitespace-nowrap"
            >
              <span className="min-w-0 truncate text-zinc-300">
                {mover.ticker}
                {/* Un asterisco donde el precio vino arrastrado: el número está
                    calculado contra un cierre que no es del período. */}
                {mover.priceIsStale ? <span className="text-amber-400/80">*</span> : null}
                {/* Un punto verde donde el cierre todavía es el precio en vivo del día. */}
                {mover.priceIsLive ? <span className="text-emerald-400/80">•</span> : null}
                {/* Marca las filas donde se operó: es la única explicación posible de
                    que el resultado y la variación del ticker discrepen de signo. */}
                {mover.hadFlow ? <span className="text-teal-400/80">°</span> : null}
              </span>
              <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                <span className={returnToneClass(currency === "ARS" ? mover.pnlArs : mover.pnlUsd)}>
                  {formatSignedMoney(
                    currency === "ARS" ? mover.pnlArs : mover.pnlUsd,
                    currency,
                    { compact: true }
                  )}
                </span>
                <span className="text-[11px] text-zinc-500">
                  {formatSignedPercentOrEmpty(mover.pricePercent)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Footnote({
  evolution,
  estimatedCutoff,
}: {
  evolution: PortfolioEvolution;
  estimatedCutoff: string | null;
}) {
  if (!evolution.hasData) return null;

  return (
    <div className="space-y-1">
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Reconstruido desde las operaciones y los cierres diarios, no desde fotos guardadas:
        corregir una operación vieja se refleja en todo el histórico. Incluye acciones,
        CEDEARs y ONs. Último cierre:{" "}
        {evolution.lastDate ? formatDateLong(evolution.lastDate) : EMPTY_VALUE}.
      </p>
      {estimatedCutoff ? (
        <p className="text-[11px] leading-relaxed text-amber-300/80">
          Los valores de ONs anteriores al {formatDayMonth(estimatedCutoff)} se estiman con
          valor técnico (residual × USD 1 × CCL del día).
        </p>
      ) : null}
    </div>
  );
}

/** Importe con signo explícito: en un resultado el signo es la información principal. */
function formatSignedMoney(
  value: number,
  currency: ViewCurrency,
  { compact = false }: { compact?: boolean } = {}
): string {
  // Compacto = pesos sin centavos: en las columnas de movers los centavos no aportan y
  // son justo lo que hace que la fila no entre.
  const formatted =
    compact && currency === "ARS"
      ? value.toLocaleString("es-AR", { style: "currency", currency, maximumFractionDigits: 0 })
      : formatMoney(value, currency);
  return `${value > 0 ? "+" : ""}${formatted}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Etiquetas del eje. En modo Valor/Resultado son plata (con notación compacta, ver
 * abajo); en modo Rendimiento % son puntos porcentuales.
 */
function formatAxisValue(value: number, currency: ViewCurrency, mode: ViewMode): string {
  if (mode === "percent") {
    return `${value >= 0 ? "+" : ""}${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
  }
  return formatAxisPrice(value, currency);
}

/**
 * Etiquetas del eje de precios.
 *
 * No usa `formatCompact` (el de los charts de recharts) porque redondea a un decimal, y
 * con zoom fino el eje entero termina repitiendo `$4,0 M` en cada tick. Con cifras
 * significativas los valores siguen distinguiéndose al acercarse, que es justo lo que
 * tiene que pasar cuando el eje acompaña al zoom.
 */
function formatAxisPrice(value: number, currency: ViewCurrency): string {
  const prefix = currency === "USD" ? "U$S " : "$";
  const formatted = new Intl.NumberFormat("es-AR", {
    notation: "compact",
    maximumSignificantDigits: 4,
  }).format(value);
  return `${prefix}${formatted}`;
}

/**
 * Primera fecha (ascendente) a partir de la cual ya ningún punto usa precio estimado de
 * ON, para el footnote. `null` si nunca hubo estimación o si el último punto de la
 * serie todavía la usa (no hay "a partir de" que mostrar todavía).
 */
function estimatedPricesCutoff(points: EvolutionPoint[]): string | null {
  let lastEstimatedIndex = -1;
  points.forEach((point, index) => {
    if (point.hasEstimatedPrices) lastEstimatedIndex = index;
  });
  if (lastEstimatedIndex === -1) return null;
  return points[lastEstimatedIndex + 1]?.date ?? null;
}

function formatDayMonth(value: string): string {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(
    new Date(value)
  );
}
