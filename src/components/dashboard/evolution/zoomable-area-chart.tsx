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
import { SERIES_COLORS } from "@/components/rendimientos/chart-utils";
import { useChartColors } from "@/components/providers/use-chart-colors";
import type { EvolutionTradeMarker } from "@/lib/dashboard/evolution-view";
import { formatAxisValue, type ViewMode } from "@/lib/dashboard/evolution-chart";
import type { ViewCurrency } from "../format";
import { CURSOR_OFFSET, HEIGHT, TOOLTIP_WIDTH, type ChartRow, type Hovered } from "./chart-model";
import { EvolutionTooltip } from "./evolution-tooltip";

/**
 * El gráfico con zoom. Usa `lightweight-charts` en vez de recharts por una razón
 * concreta: el zoom con rueda, el arrastre y el reescalado automático de los ejes vienen
 * de fábrica. En recharts habría que reimplementar los tres a mano, y el eje Y no se
 * reajustaría al tramo visible sin recalcular el dominio en cada gesto.
 *
 * Sigue el mismo patrón de refs, `ResizeObserver` y limpieza al desmontar que el resto
 * de los charts de `lightweight-charts`/`klinecharts` del repo.
 */
export function ZoomableAreaChart({
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

  // Colores resueltos de la paleta activa: lightweight-charts dibuja en canvas con
  // valores literales, así que no puede leer `var(--color-…)` directo. El chart se
  // crea una sola vez (efecto de deps `[]` más abajo) usando el valor de montaje;
  // el efecto separado más abajo lo mantiene al día si la paleta cambia después.
  const chartColors = useChartColors();
  const chartColorsRef = React.useRef(chartColors);
  React.useEffect(() => {
    chartColorsRef.current = chartColors;
  }, [chartColors]);

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
        textColor: chartColorsRef.current.zinc400,
        fontSize: 11,
        fontFamily: "inherit",
      },
      grid: {
        vertLines: { color: chartColorsRef.current.zinc800, style: LineStyle.Dotted },
        horzLines: { color: chartColorsRef.current.zinc800, style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: chartColorsRef.current.zinc800,
        // Es lo que hace que el eje Y siga al zoom: reescala al tramo visible en vez de
        // quedarse con el mínimo y máximo de toda la serie.
        autoScale: true,
        scaleMargins: { top: 0.12, bottom: 0.08 },
      },
      timeScale: {
        borderColor: chartColorsRef.current.zinc800,
        // Sin esto se puede arrastrar la serie hacia el vacío y perderla de vista.
        fixLeftEdge: true,
        fixRightEdge: true,
        rightOffset: 0,
        minBarSpacing: 0.5,
      },
      crosshair: {
        vertLine: {
          color: chartColorsRef.current.zinc600,
          width: 1,
          style: LineStyle.Dashed,
          labelVisible: true,
        },
        horzLine: {
          color: chartColorsRef.current.zinc600,
          width: 1,
          style: LineStyle.Dashed,
          labelVisible: true,
        },
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
      crosshairMarkerBorderColor: chartColorsRef.current.zinc950,
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

  // --- Paleta: reaplica colores sin recrear el chart (mismo motivo que los datos:
  // no perder zoom/estado). También corre tras el montaje, pero ahí reaplica los mismos
  // colores con los que ya nació el chart (`chartColorsRef.current`), así que es inocuo. ---
  React.useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    chart.applyOptions({
      layout: { textColor: chartColors.zinc400 },
      grid: {
        vertLines: { color: chartColors.zinc800 },
        horzLines: { color: chartColors.zinc800 },
      },
      rightPriceScale: { borderColor: chartColors.zinc800 },
      timeScale: { borderColor: chartColors.zinc800 },
      crosshair: {
        vertLine: { color: chartColors.zinc600 },
        horzLine: { color: chartColors.zinc600 },
      },
    });
    series.applyOptions({ crosshairMarkerBorderColor: chartColors.zinc950 });
  }, [chartColors]);

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
