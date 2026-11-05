"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Maximize2, Minimize2 } from "lucide-react";
// Type-only import — erased at compile time, so it doesn't pull klinecharts (which touches
// `window` at module scope, see below) into the SSR bundle.
import type {
  CandleType,
  Chart,
  Crosshair,
  DeepPartial,
  KLineData,
  OverlayCreate,
  Styles,
} from "klinecharts";
import type { MonitoringBar, MonitoringChartType, MonitoringCurrency } from "@/lib/monitoreo/types";
import type { TradeMarker, TradeMarkerSide } from "@/lib/monitoreo/trade-markers";
import {
  parseDrawings,
  serializeDrawings,
  type DrawingToolName,
} from "@/lib/monitoreo/drawings-storage";
import { markerGeometry, type MarkerGeometry } from "@/lib/monitoreo/marker-geometry";
import { getBrowserStorage, readStoredString, writeStoredString } from "@/lib/ui/safe-storage";
import { cn } from "@/lib/utils";
import { DrawingToolbar, type MagnetMode } from "./drawing-toolbar";
import { formatCurrency, formatPercent, formatTradingDate, formatVolume } from "./format";

/** Fixed id of KLineChart's main candle pane (see klinecharts' internal `PaneIdConstants`). */
const MAIN_PANE_ID = "candle_pane";
/** Vertical offset, in screen pixels (not price units), for approximate markers that fall back
 * to date placement: a fixed visual distance below the low / above the high of the bar. */
const MARKER_OFFSET_PX = 14;
/** Trade tooltip width (`w-64`), in pixels. */
const TOOLTIP_WIDTH_PX = 256;
/** Group id of user drawings among the chart's overlays (trade markers are DOM, not overlays). */
const DRAWINGS_GROUP = "user-drawings";
/** Horizontal gap between the marker and its tooltip. */
const TOOLTIP_GAP_PX = 8;
/** Keeps the vertically-centred tooltip's anchor away from the pane's top/bottom edges. */
const TOOLTIP_EDGE_MARGIN_PX = 60;
/** Price-anchored markers outside this inset are clamped to the pane edge. */
const EDGE_PADDING_PX = 10;
const AVG_COST_COLOR = "#fbbf24";

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
  /** Set when the price fell outside the pane and the marker was clamped to that edge. */
  edge: "top" | "bottom" | null;
  /** Which side of the marker the tooltip opens on, so it never covers the marker. */
  tooltipSide: "left" | "right";
}

interface OverlayLayout {
  /** Plot-area size (excludes the price axis) */
  width: number;
  height: number;
  /** Candle body width in px (klinecharts bar space), drives the marker size */
  barWidth: number;
  markers: MarkerPosition[];
  avgCostY: number | null;
  /** Set when the average cost is outside the pane and its line was clamped to that edge. */
  avgCostEdge: "top" | "bottom" | null;
}

const EMPTY_LAYOUT: OverlayLayout = { width: 0, height: 0, barWidth: 0, markers: [], avgCostY: null, avgCostEdge: null };

/** Asks the chart to bring a trade's bar into view; `seq` makes repeated clicks re-trigger. */
export interface ChartFocusRequest {
  id: string;
  seq: number;
}

interface KLineChartProps {
  bars: MonitoringBar[];
  chartType: MonitoringChartType;
  currency: MonitoringCurrency;
  ticker: string;
  /** localStorage key for this ticker+view's drawings (see `drawingsStorageKey`) */
  drawingsKey: string;
  markers: TradeMarker[];
  /** Average cost in chart scale; draws a dashed "PPC" line when set */
  avgCost?: number | null;
  /** Marker highlighted from outside (e.g. the hovered row of the trades list) */
  activeMarkerId?: string | null;
  onMarkerHover?: (id: string | null) => void;
  /** Scrolls the chart so the marker's bar is visible */
  focusRequest?: ChartFocusRequest | null;
  /** Label of the chart-scale price in the tooltip when it differs from the trade price */
  scaleLabel?: string;
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

function markerSideMeta(side: TradeMarkerSide): { color: string; glyph: string; label: string } {
  switch (side) {
    case "buy":
      return { color: "#10b981", glyph: "▲", label: "Compra" };
    case "sell":
      return { color: "#f43f5e", glyph: "▼", label: "Venta" };
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
    overlay: {
      point: {
        color: "#2dd4bf",
        borderColor: "rgba(45, 212, 191, 0.35)",
        borderSize: 1,
        radius: 4,
        activeColor: "#2dd4bf",
        activeBorderColor: "rgba(45, 212, 191, 0.35)",
        activeBorderSize: 3,
        activeRadius: 5,
      },
      line: { color: "#2dd4bf", size: 1.5 },
      text: { color: "#e4e4e7", size: 12 },
    },
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
  drawingsKey,
  markers,
  avgCost = null,
  activeMarkerId = null,
  onMarkerHover,
  focusRequest = null,
  scaleLabel = "Equivalente en el gráfico",
}: KLineChartProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<Chart | null>(null);
  // "Latest value" refs — updated from effects below (never during render, refs aren't
  // render inputs) so the mount effect and pixel-math callbacks can read current props
  // without those props becoming a chart-recreate trigger.
  const barsRef = React.useRef<MonitoringBar[]>(bars);
  const markersRef = React.useRef<TradeMarker[]>(markers);
  const chartTypeRef = React.useRef<MonitoringChartType>(chartType);
  const avgCostRef = React.useRef<number | null>(avgCost);
  const rafRef = React.useRef<number | null>(null);

  const [chartReady, setChartReady] = React.useState(false);
  const [hovered, setHovered] = React.useState<HoveredData | null>(null);
  const [layout, setLayout] = React.useState<OverlayLayout>(EMPTY_LAYOUT);
  const [hoverId, setHoverId] = React.useState<string | null>(null);
  const [mainIndicators, setMainIndicators] = React.useState<Set<MainIndicatorName>>(
    () => new Set()
  );
  const [subIndicators, setSubIndicators] = React.useState<Set<SubIndicatorName>>(
    () => new Set(["VOL"]) // VOL on by default, per spec
  );

  // --- Drawing tools (klinecharts built-in overlays), persisted per ticker+view -------------
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [activeTool, setActiveTool] = React.useState<DrawingToolName | null>(null);
  const [magnet, setMagnet] = React.useState<MagnetMode>("normal");
  const [hasSelection, setHasSelection] = React.useState(false);
  const magnetRef = React.useRef<MagnetMode>("normal");
  const drawingsKeyRef = React.useRef(drawingsKey);
  const restoringRef = React.useRef(false);
  const selectedIdRef = React.useRef<string | null>(null);
  const drawingIdRef = React.useRef<string | null>(null);

  const persistDrawings = React.useCallback((excludeId?: string) => {
    const chart = chartRef.current;
    if (!chart || restoringRef.current) return;
    const list = chart
      .getOverlays({ groupId: DRAWINGS_GROUP })
      .filter((o) => o.id !== excludeId)
      .map((o) => ({
        name: o.name,
        points: o.points,
        text: typeof o.extendData === "string" ? o.extendData : undefined,
      }));
    writeStoredString(getBrowserStorage(), drawingsKeyRef.current, serializeDrawings(list));
  }, []);

  const overlayHandlers = React.useMemo<Partial<OverlayCreate>>(
    () => ({
      onDrawEnd: () => {
        drawingIdRef.current = null;
        setActiveTool(null);
        persistDrawings();
      },
      onPressedMoveEnd: () => persistDrawings(),
      onRemoved: ({ overlay }) => {
        if (selectedIdRef.current === overlay.id) {
          selectedIdRef.current = null;
          setHasSelection(false);
        }
        if (drawingIdRef.current === overlay.id) {
          drawingIdRef.current = null;
          setActiveTool(null);
        }
        persistDrawings(overlay.id);
      },
      onSelected: ({ overlay }) => {
        selectedIdRef.current = overlay.id;
        setHasSelection(true);
      },
      onDeselected: ({ overlay }) => {
        if (selectedIdRef.current === overlay.id) {
          selectedIdRef.current = null;
          setHasSelection(false);
        }
      },
    }),
    [persistDrawings]
  );

  const cancelDrawing = React.useCallback(() => {
    const id = drawingIdRef.current;
    if (id) chartRef.current?.removeOverlay({ id });
    drawingIdRef.current = null;
    setActiveTool(null);
  }, []);

  const startDrawing = (tool: DrawingToolName | null) => {
    const chart = chartRef.current;
    cancelDrawing();
    if (!chart || tool === null) return;
    let extendData: string | undefined;
    if (tool === "simpleAnnotation") {
      const text = window.prompt("Texto de la anotación", "Nota");
      if (text === null) return;
      extendData = text.trim() || "Nota";
    }
    const id = chart.createOverlay({
      name: tool,
      groupId: DRAWINGS_GROUP,
      mode: magnetRef.current,
      extendData,
      ...overlayHandlers,
    });
    drawingIdRef.current = typeof id === "string" ? id : null;
    setActiveTool(tool);
  };

  const cycleMagnet = () => {
    const next: MagnetMode =
      magnet === "normal" ? "weak_magnet" : magnet === "weak_magnet" ? "strong_magnet" : "normal";
    magnetRef.current = next;
    setMagnet(next);
    const chart = chartRef.current;
    chart?.getOverlays({ groupId: DRAWINGS_GROUP }).forEach((o) => {
      chart.overrideOverlay({ id: o.id, mode: next });
    });
  };

  const deleteSelected = () => {
    const id = selectedIdRef.current;
    if (id) chartRef.current?.removeOverlay({ id });
  };

  const clearAllDrawings = () => {
    cancelDrawing();
    chartRef.current?.removeOverlay({ groupId: DRAWINGS_GROUP });
    persistDrawings();
  };

  // Restore the drawings of this ticker+view whenever the chart (re)mounts or the view changes.
  React.useEffect(() => {
    drawingsKeyRef.current = drawingsKey;
    const chart = chartRef.current;
    if (!chart || !chartReady) return;
    restoringRef.current = true;
    try {
      chart.removeOverlay({ groupId: DRAWINGS_GROUP });
      selectedIdRef.current = null;
      drawingIdRef.current = null;
      for (const d of parseDrawings(readStoredString(getBrowserStorage(), drawingsKey))) {
        chart.createOverlay({
          name: d.name,
          groupId: DRAWINGS_GROUP,
          points: d.points,
          extendData: d.text,
          mode: magnetRef.current,
          ...overlayHandlers,
        });
      }
    } finally {
      restoringRef.current = false;
    }
  }, [drawingsKey, chartReady, overlayHandlers]);

  // --- Fullscreen (Fullscreen API, with a fixed-position fallback) ---------------------------
  const [nativeFullscreen, setNativeFullscreen] = React.useState(false);
  const [pseudoFullscreen, setPseudoFullscreen] = React.useState(false);
  const isFullscreen = nativeFullscreen || pseudoFullscreen;

  React.useEffect(() => {
    const onChange = () => setNativeFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // One keydown handler with ordered Escape logic, so a single press does exactly one thing:
  // cancel an in-progress drawing first, otherwise leave the CSS fullscreen fallback.
  // (Native fullscreen is exited by the browser itself on Escape.)
  // Delete / Backspace removes the selected drawing.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIdRef.current) {
        event.preventDefault();
        chartRef.current?.removeOverlay({ id: selectedIdRef.current });
      } else if (event.key === "Escape") {
        if (drawingIdRef.current) cancelDrawing();
        else if (pseudoFullscreen) setPseudoFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancelDrawing, pseudoFullscreen]);

  const toggleFullscreen = async () => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    if (pseudoFullscreen) {
      setPseudoFullscreen(false);
      return;
    }
    if (typeof el.requestFullscreen === "function") {
      try {
        await el.requestFullscreen();
        return;
      } catch {
        // Denied or unsupported (e.g. iOS Safari): use the CSS fallback below.
      }
    }
    setPseudoFullscreen(true);
  };

  const recomputeMarkerPositions = React.useCallback(() => {
    const chart = chartRef.current;
    if (!chart) {
      setLayout(EMPTY_LAYOUT);
      return;
    }

    const plot = chart.getSize(MAIN_PANE_ID, "main");
    const barWidth = chart.getBarSpace().bar;
    const width = plot?.width ?? containerRef.current?.clientWidth ?? 0;
    const height = plot?.height ?? containerRef.current?.clientHeight ?? 0;
    const isCandles = chartTypeRef.current === "candles";
    const barByTime = new Map(barsRef.current.map((b) => [b.time, b]));
    const toPoint = (timestamp: number, value: number) => {
      const raw = chart.convertToPixel({ timestamp, value }, { paneId: MAIN_PANE_ID });
      const point = Array.isArray(raw) ? raw[0] : raw;
      return point && point.x !== undefined && point.y !== undefined
        ? { x: point.x, y: point.y }
        : null;
    };
    const clampY = (y: number) => Math.min(Math.max(y, EDGE_PADDING_PX), height - EDGE_PADDING_PX);

    const markers: MarkerPosition[] = [];
    for (const marker of markersRef.current) {
      const bar = barByTime.get(marker.barTime);
      if (!bar) continue;
      const timestamp = barTimestampMs(marker.barTime);

      let x: number;
      let y: number;
      let edge: MarkerPosition["edge"] = null;

      if (marker.chartPrice !== null) {
        // Exact placement: on the candle, at the trade's price. Area mode builds its y-range
        // from close only, so the price can fall outside the pane: clamp and flag the edge.
        const point = toPoint(timestamp, marker.chartPrice);
        if (!point) continue;
        x = point.x;
        if (point.y < EDGE_PADDING_PX) edge = "top";
        else if (point.y > height - EDGE_PADDING_PX) edge = "bottom";
        y = edge ? clampY(point.y) : point.y;
      } else {
        // Approximate: fall back to date placement, off the bar's high (sells) / low (buys).
        const anchorValue = !isCandles
          ? bar.close
          : marker.side === "sell"
            ? bar.high ?? bar.close
            : bar.low ?? bar.close;
        const point = toPoint(timestamp, anchorValue);
        if (!point) continue;
        x = point.x;
        y = clampY(marker.side === "sell" ? point.y - MARKER_OFFSET_PX : point.y + MARKER_OFFSET_PX);
      }

      if (x < 0 || x > width) continue;
      const hit = markerGeometry(barWidth, marker.side).hitSize;
      const fitsRight = x + hit / 2 + TOOLTIP_GAP_PX + TOOLTIP_WIDTH_PX <= width;
      markers.push({ marker, x, y, edge, tooltipSide: fitsRight ? "right" : "left" });
    }

    let avgCostY: number | null = null;
    let avgCostEdge: OverlayLayout["avgCostEdge"] = null;
    const avg = avgCostRef.current;
    const lastBar = barsRef.current[barsRef.current.length - 1];
    if (avg !== null && lastBar) {
      const point = toPoint(barTimestampMs(lastBar.time), avg);
      if (point) {
        if (point.y < EDGE_PADDING_PX) avgCostEdge = "top";
        else if (point.y > height - EDGE_PADDING_PX) avgCostEdge = "bottom";
        avgCostY = clampY(point.y);
      }
    }

    setLayout({ width, height, barWidth, markers, avgCostY, avgCostEdge });
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
      setHasSelection(false);
      setActiveTool(null);
      selectedIdRef.current = null;
      drawingIdRef.current = null;
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

  // Reposition the average-cost line when it changes.
  React.useEffect(() => {
    avgCostRef.current = avgCost;
    schedulePositionUpdate();
  }, [avgCost, schedulePositionUpdate]);

  // Scroll the requested trade's bar into view (centred) when it is outside the visible range.
  // The request stays pending until it is applied: when the page widens the range in the same
  // commit, the chart may still hold the old bars, so it is retried after each data reload.
  const pendingFocusRef = React.useRef<ChartFocusRequest | null>(null);
  const tryApplyFocus = React.useCallback(() => {
    const request = pendingFocusRef.current;
    const chart = chartRef.current;
    if (!request || !chart) return;
    const marker = markersRef.current.find((m) => m.id === request.id);
    if (!marker) return;

    const timestamp = barTimestampMs(marker.barTime);
    const dataList = chart.getDataList();
    const index = dataList.findIndex((d) => d.timestamp === timestamp);
    if (index < 0) return; // data not loaded yet: keep pending

    pendingFocusRef.current = null;
    const { from, to } = chart.getVisibleRange();
    if (index >= from && index <= to) return;
    // `scrollToDataIndex` puts the bar at the right edge: aim half a screen further to centre it.
    const half = Math.floor((to - from) / 2);
    chart.scrollToDataIndex(Math.min(dataList.length - 1, index + half), 200);
  }, []);

  const lastFocusRequestRef = React.useRef<ChartFocusRequest | null>(null);
  React.useEffect(() => {
    // Only a NEW request becomes pending; later bars/markers changes just retry the pending one.
    if (focusRequest !== lastFocusRequestRef.current) {
      lastFocusRequestRef.current = focusRequest;
      pendingFocusRef.current = focusRequest;
    }
    if (!chartReady) return;
    tryApplyFocus();
    if (pendingFocusRef.current) {
      // Data reload not applied yet: retry on the next frame, and again when bars/markers change.
      const raf = requestAnimationFrame(tryApplyFocus);
      return () => cancelAnimationFrame(raf);
    }
  }, [focusRequest, chartReady, bars, markers, tryApplyFocus]);

  // A different instrument mounts a fresh chart: drop any request left over from the old one.
  React.useEffect(() => {
    return () => {
      pendingFocusRef.current = null;
      lastFocusRequestRef.current = null;
    };
  }, [ticker]);

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

  // A marker hovered in the chart wins over one highlighted from the trades list.
  const highlightedId = hoverId ?? activeMarkerId;
  const highlighted = highlightedId
    ? (layout.markers.find((p) => p.marker.id === highlightedId) ?? null)
    : null;

  const indicatorButton = (active: boolean) =>
    `rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
      active
        ? "border-teal-800/60 bg-teal-950 text-teal-300"
        : "border-zinc-800 bg-zinc-900/90 text-zinc-400 hover:text-zinc-200"
    }`;

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative isolate flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950 p-3 shadow-sm",
        pseudoFullscreen && "fixed inset-0 z-50 h-dvh rounded-none border-0"
      )}
    >
      {/* Chart top bar: crosshair values on a single line (never wraps over the page above) */}
      <div className="flex min-w-0 shrink-0 items-center gap-3 border-b border-zinc-800/60 pb-2">
        <div className="flex min-w-0 shrink-0 items-baseline gap-2">
          <span className="text-sm font-bold tracking-tight text-zinc-100">{ticker}</span>
          <span className="font-mono text-base font-bold tracking-tight text-zinc-50">
            {formatCurrency(currentDisplay.close, currency)}
          </span>
          <span
            className={`font-mono text-xs font-medium ${isPositive ? "text-emerald-400" : "text-rose-400"}`}
          >
            {formatPercent(currentDisplay.changePct)}
          </span>
          <span className="hidden text-[11px] text-zinc-500 sm:inline">
            {formatTradingDate(currentDisplay.time)}
          </span>
        </div>

        {chartType === "candles" && currentDisplay.open !== null && bars.length > 0 && (
          <div className="hidden min-w-0 flex-1 items-center gap-3 overflow-hidden whitespace-nowrap font-mono text-[11px] text-zinc-400 md:flex">
            <span>
              <span className="text-zinc-500">O </span>
              <span className="text-zinc-200">{formatCurrency(currentDisplay.open, currency)}</span>
            </span>
            <span>
              <span className="text-zinc-500">H </span>
              <span className="text-zinc-200">{formatCurrency(currentDisplay.high, currency)}</span>
            </span>
            <span>
              <span className="text-zinc-500">L </span>
              <span className="text-zinc-200">{formatCurrency(currentDisplay.low, currency)}</span>
            </span>
            <span>
              <span className="text-zinc-500">C </span>
              <span className="text-zinc-200">{formatCurrency(currentDisplay.close, currency)}</span>
            </span>
            {currentDisplay.volume !== null && (
              <span>
                <span className="text-zinc-500">Vol </span>
                <span className="text-zinc-300">{formatVolume(currentDisplay.volume)}</span>
              </span>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          title={isFullscreen ? "Salir de pantalla completa (Esc)" : "Pantalla completa"}
          aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        >
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      {/* Indicator picker */}
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <div className="flex items-center gap-1">
          <span className="text-zinc-500">Precio:</span>
          {MAIN_PANE_INDICATORS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => toggleMainIndicator(name)}
              className={indicatorButton(mainIndicators.has(name))}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-zinc-500">Vol / Osc.:</span>
          {SUB_PANE_INDICATORS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => toggleSubIndicator(name)}
              className={indicatorButton(subIndicators.has(name))}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Drawing toolbar + chart canvas + trade marker overlays */}
      <div className="mt-2 flex min-h-0 flex-1 gap-2">
        <DrawingToolbar
          activeTool={activeTool}
          magnet={magnet}
          hasSelection={hasSelection}
          onSelectTool={startDrawing}
          onCycleMagnet={cycleMagnet}
          onDeleteSelected={deleteSelected}
          onClearAll={clearAllDrawings}
        />
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="h-full w-full" ref={containerRef} />

        {bars.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center text-zinc-500">
            <p className="text-sm font-medium">Sin datos para graficar</p>
            <p className="mt-1 text-xs text-zinc-600">
              Este activo no tiene precios disponibles para el rango seleccionado.
            </p>
          </div>
        )}

        {/* Dashed guides: average cost across the pane, hovered marker out to the price axis */}
        <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full" aria-hidden>
          {layout.avgCostY !== null && (
            <line
              x1={0}
              x2={layout.width}
              y1={layout.avgCostY}
              y2={layout.avgCostY}
              stroke={AVG_COST_COLOR}
              strokeWidth={1}
              strokeDasharray="6 4"
              opacity={layout.avgCostEdge ? 0.4 : 0.8}
            />
          )}
          {highlighted && highlighted.marker.chartPrice !== null && !highlighted.edge && (
            <line
              x1={highlighted.x}
              x2={layout.width}
              y1={highlighted.y}
              y2={highlighted.y}
              stroke={markerSideMeta(highlighted.marker.side).color}
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          )}
        </svg>

        {layout.avgCostY !== null && avgCost !== null && (
          <div
            className="pointer-events-none absolute z-[6] inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-950"
            style={{
              left: layout.width - 4,
              top: layout.avgCostY,
              // Above the line, except at the top edge where it would be clipped.
              transform: layout.avgCostEdge === "top" ? "translate(-100%, 5%)" : "translate(-100%, -105%)",
              backgroundColor: AVG_COST_COLOR,
            }}
          >
            {layout.avgCostEdge === "top" && <ArrowUp className="h-3 w-3" aria-hidden />}
            {layout.avgCostEdge === "bottom" && <ArrowDown className="h-3 w-3" aria-hidden />}
            PPC {formatPrice(avgCost)}
          </div>
        )}

        {highlighted && highlighted.marker.chartPrice !== null && !highlighted.edge && (
          <div
            className="pointer-events-none absolute z-[6] rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-950"
            style={{
              left: layout.width,
              top: highlighted.y,
              transform: "translateY(-50%)",
              backgroundColor: markerSideMeta(highlighted.marker.side).color,
            }}
          >
            {formatPrice(highlighted.marker.chartPrice)}
          </div>
        )}

        {/* The layer itself never takes pointer events, so drag-to-pan and wheel zoom reach the
            chart; only the marker hit targets do, and not while a drawing tool is active. */}
        <div className="pointer-events-none absolute inset-0 z-10">
          {layout.markers.map((position) => {
            const { marker, x, y, edge } = position;
            const meta = markerSideMeta(marker.side);
            const isHighlighted = marker.id === highlightedId;
            const geometry = markerGeometry(layout.barWidth, marker.side);
            return (
              <button
                key={marker.id}
                type="button"
                className={cn(
                  "absolute flex items-center justify-center",
                  activeTool === null ? "pointer-events-auto" : "pointer-events-none"
                )}
                style={{
                  left: x,
                  top: y,
                  width: geometry.hitSize,
                  height: geometry.hitSize,
                  transform: "translate(-50%, -50%)",
                }}
                onMouseEnter={() => {
                  setHoverId(marker.id);
                  onMarkerHover?.(marker.id);
                }}
                onMouseLeave={() => {
                  setHoverId((prev) => (prev === marker.id ? null : prev));
                  onMarkerHover?.(null);
                }}
                aria-label={`${meta.label} — ${formatTradingDate(marker.trade.tradeDate)}`}
              >
                <MarkerGlyph
                  geometry={geometry}
                  color={meta.color}
                  approximate={marker.approximate}
                  edge={edge}
                  highlighted={isHighlighted}
                />
              </button>
            );
          })}
        </div>

        {highlighted && (
          <TradeMarkerTooltip
            position={highlighted}
            paneHeight={layout.height}
            chartCurrency={currency}
            scaleLabel={scaleLabel}
          />
        )}
        </div>
      </div>
    </div>
  );
}

function MarkerGlyph({
  geometry,
  color,
  approximate,
  edge,
  highlighted,
}: {
  geometry: MarkerGeometry;
  color: string;
  approximate: boolean;
  edge: MarkerPosition["edge"];
  highlighted: boolean;
}) {
  if (edge) {
    const Arrow = edge === "top" ? ArrowUp : ArrowDown;
    return <Arrow className="h-3 w-3" style={{ color }} />;
  }
  const scale = highlighted ? 1.35 : 1;
  if (geometry.shape === "tick") {
    // Exactly one candle wide: never covers neighbouring candles.
    return (
      <span
        className="block"
        style={{
          width: geometry.width,
          height: geometry.height,
          backgroundColor: color,
          opacity: approximate ? 0.6 : 1,
          boxShadow: highlighted ? "0 0 0 1px #fafafa" : undefined,
          transform: `scale(${scale})`,
        }}
      />
    );
  }
  const points = geometry.shape === "triangle-up" ? "5,0.5 9.5,9.5 0.5,9.5" : "0.5,0.5 9.5,0.5 5,9.5";
  return (
    <svg
      viewBox="0 0 10 10"
      width={geometry.width}
      height={geometry.height}
      style={{ overflow: "visible", transform: `scale(${scale})` }}
      aria-hidden
    >
      {geometry.ringWidth > 0 && (
        <polygon
          points={points}
          fill="none"
          stroke={highlighted ? "#fafafa" : "#09090b"}
          strokeWidth={geometry.ringWidth * 2 * (10 / geometry.width)}
          strokeLinejoin="round"
        />
      )}
      <polygon
        points={points}
        fill={approximate ? "none" : color}
        stroke={approximate ? color : "none"}
        strokeWidth={approximate ? 1.5 : 0}
        strokeDasharray={approximate ? "2 1.5" : undefined}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatPrice(value: number): string {
  return value.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function TradeMarkerTooltip({
  position,
  paneHeight,
  chartCurrency,
  scaleLabel,
}: {
  position: MarkerPosition;
  paneHeight: number;
  chartCurrency: MonitoringCurrency;
  scaleLabel: string;
}) {
  const { marker } = position;
  const meta = markerSideMeta(marker.side);
  const trade = marker.trade;
  const tradeCurrency: MonitoringCurrency = trade.currencyCode === "USD" ? "USD" : "ARS";

  const top = Math.min(
    Math.max(position.y, TOOLTIP_EDGE_MARGIN_PX),
    paneHeight - TOOLTIP_EDGE_MARGIN_PX
  );
  const horizontalOffset = 8 + TOOLTIP_GAP_PX; // half the (max) hit area + gap
  const left =
    position.tooltipSide === "right"
      ? position.x + horizontalOffset
      : position.x - horizontalOffset - TOOLTIP_WIDTH_PX;

  const showScalePrice =
    marker.chartPrice !== null &&
    (chartCurrency !== tradeCurrency || Math.abs(marker.chartPrice - trade.price) > 0.005);

  return (
    <div
      // pointer-events-none: the tooltip must never steal hover from the marker it describes.
      className="pointer-events-none absolute z-20 w-64 -translate-y-1/2 rounded-lg border border-zinc-800 bg-zinc-950/95 p-3 text-xs shadow-lg backdrop-blur"
      style={{ left, top }}
    >
      <div className="flex items-center justify-between border-b border-zinc-800/60 pb-1.5">
        <span className="font-semibold text-zinc-100">{formatTradingDate(trade.tradeDate)}</span>
        <span className="font-medium" style={{ color: meta.color }}>
          {meta.label}
        </span>
      </div>

      <div className="mt-1.5 flex flex-col gap-0.5 text-zinc-300">
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">Cantidad @ precio</span>
          <span className="font-mono text-zinc-200">
            {trade.quantity.toLocaleString("es-AR")} @ {formatCurrency(trade.price, tradeCurrency)}
          </span>
        </div>
        {showScalePrice && marker.chartPrice !== null && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">{scaleLabel}</span>
            <span className="font-mono text-zinc-200">
              {formatCurrency(marker.chartPrice, chartCurrency)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between text-zinc-500">
          <span>
            Bruto: {formatCurrency(trade.grossAmount, tradeCurrency)} · Comisiones:{" "}
            {formatCurrency(trade.fees, tradeCurrency)}
          </span>
        </div>
        {trade.changeSinceTradePct !== null && (
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Desde la operación</span>
            <span
              className={`font-mono ${trade.changeSinceTradePct >= 0 ? "text-emerald-400" : "text-rose-400"}`}
            >
              {formatPercent(trade.changeSinceTradePct)}
            </span>
          </div>
        )}
        {marker.approximate && (
          <span className="text-amber-400">Precio aproximado: ubicado por fecha</span>
        )}
      </div>
    </div>
  );
}
