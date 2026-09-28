"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
// Type-only import — erased at compile time, so it doesn't pull klinecharts (which touches
// `window` at module scope, see below) into the SSR bundle.
import type { CandleType, Chart, Crosshair, DeepPartial, KLineData, Styles } from "klinecharts";
import type { MonitoringBar, MonitoringChartType, MonitoringCurrency } from "@/lib/monitoreo/types";
import type { TradeMarker, TradeMarkerSide } from "@/lib/monitoreo/trade-markers";
import { formatCurrency, formatPercent, formatTradingDate, formatVolume } from "./format";

/** Fixed id of KLineChart's main candle pane (see klinecharts' internal `PaneIdConstants`). */
const MAIN_PANE_ID = "candle_pane";
/** Vertical offset, in screen pixels (not price units) — keeps markers a fixed visual
 * distance below/above the bar regardless of the pane's price scale. */
const MARKER_OFFSET_PX = 14;
/** Marker circle size (Tailwind `h-4 w-4`) and trade tooltip width (`w-64`), in pixels. */
const MARKER_SIZE_PX = 16;
const TOOLTIP_WIDTH_PX = 256;
/** Horizontal gap between the marker circle and its tooltip. */
const TOOLTIP_GAP_PX = 8;
/** Keeps the vertically-centred tooltip's anchor away from the pane's top/bottom edges. */
const TOOLTIP_EDGE_MARGIN_PX = 60;

const MAIN_PANE_INDICATORS = ["MA", "EMA", "BOLL", "SAR"] as const;
const SUB_PANE_INDICATORS = ["VOL", "MACD", "RSI", "KDJ"] as const;
type MainIndicatorName = (typeof MAIN_PANE_INDICATORS)[number];
type SubIndicatorName = (typeof SUB_PANE_INDICATORS)[number];

interface HoveredData {
  time: string;
  close: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  changePct?: number | null;
}

interface MarkerPosition {
  marker: TradeMarker;
  x: number;
  y: number;
  /** Which side of the marker the tooltip opens on, so it never covers the circle. */
  tooltipSide: "left" | "right";
}

interface KLineChartProps {
  bars: MonitoringBar[];
  chartType: MonitoringChartType;
  currency: MonitoringCurrency;
  ticker: string;
  height?: number;
  markers: TradeMarker[];
}

function barTimestampMs(time: string): number {
  return Date.parse(`${time}T00:00:00.000Z`);
}

function barToKLineData(bar: MonitoringBar): KLineData {
  return {
    timestamp: barTimestampMs(bar.time),
    open: bar.open ?? bar.close,
    high: bar.high ?? bar.close,
    low: bar.low ?? bar.close,
    close: bar.close,
    volume: bar.volume ?? undefined,
  };
}

function markerSideMeta(side: TradeMarkerSide): { color: string; Icon: typeof ArrowUp; label: string } {
  switch (side) {
    case "buy":
      return { color: "#10b981", Icon: ArrowUp, label: "Compra" };
    case "sell":
      return { color: "#f43f5e", Icon: ArrowDown, label: "Venta" };
    default:
      return { color: "#a1a1aa", Icon: ArrowUpDown, label: "Mixta" };
  }
}

/** Dark zinc theme matching the rest of /monitoreo (see the old lightweight-charts config
 * this replaces). Only candle type is swapped per-render; everything else is static. */
function buildDarkStyles(chartType: MonitoringChartType): DeepPartial<Styles> {
  const candleType: CandleType = chartType === "candles" ? "candle_solid" : "area";
  return {
    grid: {
      horizontal: { show: true, color: "#27272a" },
      vertical: { show: true, color: "#27272a" },
    },
    candle: {
      type: candleType,
      bar: {
        upColor: "#10b981",
        downColor: "#f43f5e",
        noChangeColor: "#71717a",
        upBorderColor: "#10b981",
        downBorderColor: "#f43f5e",
        noChangeBorderColor: "#71717a",
        upWickColor: "#10b981",
        downWickColor: "#f43f5e",
        noChangeWickColor: "#71717a",
      },
      area: {
        lineColor: "#14b8a6",
        lineSize: 2,
        value: "close",
        smooth: false,
        backgroundColor: [
          { offset: 0, color: "rgba(20, 184, 166, 0.28)" },
          { offset: 1, color: "rgba(20, 184, 166, 0)" },
        ],
      },
      // KLineChart's own crosshair tooltip is disabled — the OHLCV top bar (driven by
      // `onCrosshairChange` below) already covers it, and we don't want two overlapping boxes.
      tooltip: { showRule: "none" },
    },
    indicator: {
      tooltip: { showRule: "follow_cross" },
    },
    xAxis: {
      axisLine: { color: "#3f3f46" },
      tickLine: { color: "#3f3f46" },
      tickText: { color: "#a1a1aa" },
    },
    yAxis: {
      axisLine: { color: "#3f3f46" },
      tickLine: { color: "#3f3f46" },
      tickText: { color: "#a1a1aa" },
    },
    separator: { size: 1, color: "#27272a" },
    crosshair: {
      horizontal: {
        line: { color: "#71717a" },
        text: { color: "#e4e4e7", backgroundColor: "#18181b" },
      },
      vertical: {
        line: { color: "#71717a" },
        text: { color: "#e4e4e7", backgroundColor: "#18181b" },
      },
    },
  };
}

export function KLineChart({
  bars,
  chartType,
  currency,
  ticker,
  height = 420,
  markers,
}: KLineChartProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<Chart | null>(null);
  // "Latest value" refs — updated from effects below (never during render, refs aren't
  // render inputs) so the mount effect and pixel-math callbacks can read current props
  // without those props becoming a chart-recreate trigger.
  const barsRef = React.useRef<MonitoringBar[]>(bars);
  const markersRef = React.useRef<TradeMarker[]>(markers);
  const chartTypeRef = React.useRef<MonitoringChartType>(chartType);
  const rafRef = React.useRef<number | null>(null);

  const [chartReady, setChartReady] = React.useState(false);
  const [hovered, setHovered] = React.useState<HoveredData | null>(null);
  const [markerPositions, setMarkerPositions] = React.useState<MarkerPosition[]>([]);
  const [activeMarker, setActiveMarker] = React.useState<TradeMarker | null>(null);
  const [mainIndicators, setMainIndicators] = React.useState<Set<MainIndicatorName>>(
    () => new Set()
  );
  const [subIndicators, setSubIndicators] = React.useState<Set<SubIndicatorName>>(
    () => new Set(["VOL"]) // VOL on by default, per spec
  );

  const recomputeMarkerPositions = React.useCallback(() => {
    const chart = chartRef.current;
    if (!chart) {
      setMarkerPositions([]);
      return;
    }

    const barByTime = new Map(barsRef.current.map((b) => [b.time, b]));
    const paneWidth = containerRef.current?.clientWidth ?? 0;
    const next: MarkerPosition[] = [];

    for (const marker of markersRef.current) {
      const bar = barByTime.get(marker.barTime);
      if (!bar) continue;

      // Anchor: sell markers hang off the bar's high, buy/mixed off the bar's low — see
      // trade-markers.ts placement rule (never by trade price). In area mode the y-axis range
      // is built from `close` only, so high/low could fall outside the pane: anchor on close.
      const isCandles = chartTypeRef.current === "candles";
      const anchorValue = !isCandles
        ? bar.close
        : marker.side === "sell"
          ? bar.high ?? bar.close
          : bar.low ?? bar.close;
      const raw = chart.convertToPixel(
        { timestamp: barTimestampMs(marker.barTime), value: anchorValue },
        { paneId: MAIN_PANE_ID }
      );
      const point = Array.isArray(raw) ? raw[0] : raw;
      if (!point || point.x === undefined || point.y === undefined) continue;

      const y = marker.side === "sell" ? point.y - MARKER_OFFSET_PX : point.y + MARKER_OFFSET_PX;
      const fitsRight =
        point.x + MARKER_SIZE_PX / 2 + TOOLTIP_GAP_PX + TOOLTIP_WIDTH_PX <= paneWidth;
      next.push({ marker, x: point.x, y, tooltipSide: fitsRight ? "right" : "left" });
    }

    setMarkerPositions(next);
  }, []);

  const schedulePositionUpdate = React.useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      recomputeMarkerPositions();
    });
  }, [recomputeMarkerPositions]);

  const handleCrosshairChange = React.useCallback((raw?: unknown) => {
    const crosshair = raw as Crosshair | undefined;
    if (!crosshair || crosshair.kLineData === undefined || crosshair.dataIndex === undefined) {
      setHovered(null);
      return;
    }

    const k = crosshair.kLineData;
    const idx = crosshair.dataIndex;
    const prevClose = idx > 0 ? barsRef.current[idx - 1]?.close ?? null : null;
    const changePct =
      prevClose && prevClose > 0 ? ((k.close - prevClose) / prevClose) * 100 : null;

    setHovered({
      time: barsRef.current[idx]?.time ?? new Date(k.timestamp).toISOString().slice(0, 10),
      close: k.close,
      open: k.open,
      high: k.high,
      low: k.low,
      volume: k.volume ?? null,
      changePct,
    });
  }, []);

  // Create the chart once and dispose it on unmount, or when the instrument (ticker) itself
  // changes — a genuinely different chart. Bars/chartType/currency/markers updates below are
  // applied to the same instance via targeted store calls, never a full recreate.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let chart: Chart | null = null;

    import("klinecharts").then(({ init }) => {
      if (disposed || !container) return;

      chart = init(container, { styles: buildDarkStyles(chartType) });
      if (!chart) return;
      chartRef.current = chart;

      chart.setSymbol({ ticker });
      chart.setPeriod({ span: 1, type: "day" });
      // v10 uses a pull-based DataLoader instead of the old applyNewData/setData API — the
      // chart calls `getBars` itself on setSymbol/setPeriod/resetData/scroll-to-boundary.
      // We hold the full range in memory already, so every call just hands back the current
      // bars for "init" and signals "no more data" otherwise (no real pagination needed).
      chart.setDataLoader({
        getBars: ({ type, callback }) => {
          if (type === "init") {
            callback(barsRef.current.map(barToKLineData), false);
          } else {
            callback([], false);
          }
        },
      });

      chart.subscribeAction("onCrosshairChange", handleCrosshairChange);
      chart.subscribeAction("onZoom", schedulePositionUpdate);
      chart.subscribeAction("onScroll", schedulePositionUpdate);
      chart.subscribeAction("onVisibleRangeChange", schedulePositionUpdate);

      setChartReady(true);
      schedulePositionUpdate();
    });

    return () => {
      disposed = true;
      setChartReady(false);
      setHovered(null);
      const current = chart;
      if (current) {
        current.unsubscribeAction("onCrosshairChange", handleCrosshairChange);
        current.unsubscribeAction("onZoom", schedulePositionUpdate);
        current.unsubscribeAction("onScroll", schedulePositionUpdate);
        current.unsubscribeAction("onVisibleRangeChange", schedulePositionUpdate);
        import("klinecharts").then(({ dispose }) => dispose(container));
      }
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only `ticker` recreates the chart
  }, [ticker]);

  // Re-apply the same chart instance's data when bars change (range/currency/history load).
  React.useEffect(() => {
    barsRef.current = bars;
    chartRef.current?.resetData();
    schedulePositionUpdate();
  }, [bars, schedulePositionUpdate]);

  // Candle vs area toggle — a style update, not a data reload.
  React.useEffect(() => {
    chartTypeRef.current = chartType;
    const chart = chartRef.current;
    if (!chart || !chartReady) return;
    chart.setStyles(buildDarkStyles(chartType));
    // The y-axis range and marker anchors both depend on the candle type.
    schedulePositionUpdate();
  }, [chartType, chartReady, schedulePositionUpdate]);

  // Reposition markers whenever the marker set itself changes.
  React.useEffect(() => {
    markersRef.current = markers;
    schedulePositionUpdate();
  }, [markers, schedulePositionUpdate]);

  // Sync the indicator picker state onto the chart instance.
  React.useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !chartReady) return;

    for (const name of MAIN_PANE_INDICATORS) {
      const active = mainIndicators.has(name);
      const exists = chart.getIndicators({ name }).length > 0;
      if (active && !exists) chart.createIndicator(name);
      else if (!active && exists) chart.removeIndicator({ name });
    }
    for (const name of SUB_PANE_INDICATORS) {
      const active = subIndicators.has(name);
      const exists = chart.getIndicators({ name }).length > 0;
      if (active && !exists) chart.createIndicator(name);
      else if (!active && exists) chart.removeIndicator({ name });
    }
  }, [mainIndicators, subIndicators, chartReady]);

  // Resize handling, mirrors the previous lightweight-charts component.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          chartRef.current?.resize();
          schedulePositionUpdate();
        }
      }
    });
    resizeObserver.observe(container);

    return () => resizeObserver.disconnect();
  }, [schedulePositionUpdate]);

  React.useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      // Must be cleared too: a stale id would make `schedulePositionUpdate` bail forever after
      // a remount (e.g. React Strict Mode's dev mount → unmount → mount), so markers never render.
      rafRef.current = null;
    };
  }, []);

  const toggleMainIndicator = (name: MainIndicatorName) => {
    setMainIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleSubIndicator = (name: SubIndicatorName) => {
    setSubIndicators((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Active/latest point for the info header — mirrors previous component behaviour.
  const latestBar = bars.length > 0 ? bars[bars.length - 1]! : null;
  const prevToLatestClose = bars.length > 1 ? bars[bars.length - 2]!.close : null;
  const latestChangePct =
    latestBar && prevToLatestClose && prevToLatestClose > 0
      ? ((latestBar.close - prevToLatestClose) / prevToLatestClose) * 100
      : null;

  const currentDisplay: HoveredData =
    hovered ??
    (latestBar
      ? {
          time: latestBar.time,
          close: latestBar.close,
          open: latestBar.open,
          high: latestBar.high,
          low: latestBar.low,
          volume: latestBar.volume,
          changePct: latestChangePct,
        }
      : { time: "", close: 0, changePct: null });

  const isPositive = (currentDisplay.changePct ?? 0) >= 0;

  return (
    <div className="relative flex flex-col w-full rounded-xl border border-zinc-800/80 bg-zinc-950/70 p-4 shadow-sm backdrop-blur">
      {/* Chart Top bar / Dynamic Crosshair Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/60 pb-3">
        <div className="flex items-baseline gap-3">
          <span className="text-lg font-bold tracking-tight text-zinc-100">{ticker}</span>
          <span className="text-2xl font-mono font-bold tracking-tight text-zinc-50">
            {formatCurrency(currentDisplay.close, currency)}
          </span>
          <span
            className={`text-sm font-medium font-mono ${
              isPositive ? "text-emerald-400" : "text-rose-400"
            }`}
          >
            {formatPercent(currentDisplay.changePct)}
          </span>
          <span className="text-xs text-zinc-500">
            Rueda: {formatTradingDate(currentDisplay.time)}
          </span>
        </div>

        {chartType === "candles" && currentDisplay.open !== null && bars.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-zinc-400">
            <div>
              <span className="text-zinc-500">O: </span>
              <span className="text-zinc-200">{formatCurrency(currentDisplay.open, currency)}</span>
            </div>
            <div>
              <span className="text-zinc-500">H: </span>
              <span className="text-zinc-200">{formatCurrency(currentDisplay.high, currency)}</span>
            </div>
            <div>
              <span className="text-zinc-500">L: </span>
              <span className="text-zinc-200">{formatCurrency(currentDisplay.low, currency)}</span>
            </div>
            <div>
              <span className="text-zinc-500">C: </span>
              <span className="text-zinc-200">{formatCurrency(currentDisplay.close, currency)}</span>
            </div>
            {currentDisplay.volume !== null && (
              <div>
                <span className="text-zinc-500">Vol: </span>
                <span className="text-zinc-300">{formatVolume(currentDisplay.volume)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Indicator picker */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Precio:</span>
          {MAIN_PANE_INDICATORS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => toggleMainIndicator(name)}
              className={`rounded-md border px-2 py-1 font-medium transition-colors ${
                mainIndicators.has(name)
                  ? "border-teal-800/60 bg-teal-950 text-teal-300"
                  : "border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Volumen / Osciladores:</span>
          {SUB_PANE_INDICATORS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => toggleSubIndicator(name)}
              className={`rounded-md border px-2 py-1 font-medium transition-colors ${
                subIndicators.has(name)
                  ? "border-teal-800/60 bg-teal-950 text-teal-300"
                  : "border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Chart canvas + trade marker overlays */}
      <div className="relative mt-2 w-full overflow-hidden" style={{ height }}>
        <div className="h-full w-full" ref={containerRef} />

        {bars.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center text-zinc-500">
            <p className="text-sm font-medium">Sin datos para graficar</p>
            <p className="mt-1 text-xs text-zinc-600">
              Probá cargando el histórico o seleccionando otro rango de fechas.
            </p>
          </div>
        )}

        {markerPositions.map(({ marker, x, y }) => {
          const meta = markerSideMeta(marker.side);
          return (
            <button
              key={marker.barTime}
              type="button"
              className="absolute z-10 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full border border-zinc-950/60 shadow"
              style={{
                left: x,
                top: y,
                backgroundColor: meta.color,
                transform:
                  marker.side === "sell"
                    ? "translate(-50%, -100%)"
                    : "translate(-50%, 0%)",
              }}
              onMouseEnter={() => setActiveMarker(marker)}
              onMouseLeave={() => setActiveMarker((prev) => (prev === marker ? null : prev))}
              aria-label={`${meta.label} — ${formatTradingDate(marker.barTime)}`}
            >
              <meta.Icon className="h-3 w-3 text-zinc-950" />
            </button>
          );
        })}

        {activeMarker && (
          <TradeMarkerTooltip
            marker={activeMarker}
            position={markerPositions.find((p) => p.marker === activeMarker) ?? null}
            paneHeight={height}
          />
        )}
      </div>
    </div>
  );
}

function TradeMarkerTooltip({
  marker,
  position,
  paneHeight,
}: {
  marker: TradeMarker;
  position: MarkerPosition | null;
  paneHeight: number;
}) {
  if (!position) return null;
  const meta = markerSideMeta(marker.side);

  // The circle hangs above the anchor for sells and below it for buys/mixed (see the marker
  // button's transform); centre the tooltip on the circle, beside it, so the two never overlap
  // and moving the pointer within the circle can't land on the tooltip.
  const circleCenterY =
    marker.side === "sell" ? position.y - MARKER_SIZE_PX / 2 : position.y + MARKER_SIZE_PX / 2;
  const top = Math.min(
    Math.max(circleCenterY, TOOLTIP_EDGE_MARGIN_PX),
    paneHeight - TOOLTIP_EDGE_MARGIN_PX
  );
  const horizontalOffset = MARKER_SIZE_PX / 2 + TOOLTIP_GAP_PX;
  const left =
    position.tooltipSide === "right"
      ? position.x + horizontalOffset
      : position.x - horizontalOffset - TOOLTIP_WIDTH_PX;

  return (
    <div
      // pointer-events-none: the tooltip must never steal hover from the marker it describes.
      className="pointer-events-none absolute z-20 w-64 -translate-y-1/2 rounded-lg border border-zinc-800 bg-zinc-950/95 p-3 text-xs shadow-lg backdrop-blur"
      style={{ left, top }}
    >
      <div className="flex items-center justify-between border-b border-zinc-800/60 pb-1.5">
        <span className="font-semibold text-zinc-100">{formatTradingDate(marker.barTime)}</span>
        <span className="font-medium" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>

      <ul className="mt-1.5 space-y-1.5">
        {marker.trades.map((trade) => {
          const tradeCurrency = trade.currencyCode === "USD" ? "USD" : "ARS";
          return (
            <li key={trade.id} className="flex flex-col gap-0.5 text-zinc-300">
              <div className="flex items-center justify-between">
                <span className={trade.side === "BUY" ? "text-emerald-400" : "text-rose-400"}>
                  {trade.side === "BUY" ? "Compra" : "Venta"} · {formatTradingDate(trade.tradeDate)}
                </span>
                <span className="font-mono text-zinc-200">
                  {trade.quantity.toLocaleString("es-AR")} @ {formatCurrency(trade.price, tradeCurrency)}
                </span>
              </div>
              <div className="flex items-center justify-between text-zinc-500">
                <span>
                  Bruto: {formatCurrency(trade.grossAmount, tradeCurrency)} · Comisiones:{" "}
                  {formatCurrency(trade.fees, tradeCurrency)}
                </span>
                {trade.changeSinceTradePct !== null && (
                  <span
                    className={trade.changeSinceTradePct >= 0 ? "text-emerald-400" : "text-rose-400"}
                  >
                    {formatPercent(trade.changeSinceTradePct)}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {marker.trades.length > 1 && (
        <div className="mt-1.5 border-t border-zinc-800/60 pt-1.5 text-zinc-400">
          Neto: {marker.totals.netQuantity.toLocaleString("es-AR")} · Comisiones totales:{" "}
          {formatCurrency(
            marker.totals.totalFees,
            marker.trades[0]!.currencyCode === "USD" ? "USD" : "ARS"
          )}
        </div>
      )}
    </div>
  );
}
