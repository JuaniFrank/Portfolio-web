"use client";

import * as React from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
} from "lightweight-charts";
import type { MonitoringBar, MonitoringChartType, MonitoringCurrency } from "@/lib/monitoreo/types";
import { formatCurrency, formatPercent, formatTradingDate, formatVolume } from "./format";

interface HoveredData {
  time: string;
  close: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  changePct?: number | null;
}

interface MonitoringChartProps {
  bars: MonitoringBar[];
  chartType: MonitoringChartType;
  currency: MonitoringCurrency;
  ticker: string;
  height?: number;
}

export function MonitoringChart({
  bars,
  chartType,
  currency,
  ticker,
  height = 420,
}: MonitoringChartProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const chartRef = React.useRef<IChartApi | null>(null);
  const seriesRef = React.useRef<ISeriesApi<"Line"> | ISeriesApi<"Candlestick"> | null>(null);

  const [hovered, setHovered] = React.useState<HoveredData | null>(null);

  // Lookup map for fast changePct and OHLC lookup during crosshair movement
  const barsMap = React.useMemo(() => {
    const map = new Map<string, { bar: MonitoringBar; prevClose: number | null }>();
    for (let i = 0; i < bars.length; i++) {
      const current = bars[i]!;
      const prevClose = i > 0 ? bars[i - 1]!.close : null;
      map.set(current.time, { bar: current, prevClose });
    }
    return map;
  }, [bars]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create chart
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a1a1aa",
        fontSize: 12,
        fontFamily: "inherit",
      },
      grid: {
        vertLines: { color: "#27272a", style: 1 },
        horzLines: { color: "#27272a", style: 1 },
      },
      rightPriceScale: {
        borderColor: "#3f3f46",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#3f3f46",
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        vertLine: { color: "#71717a", width: 1, style: 2 },
        horzLine: { color: "#71717a", width: 1, style: 2 },
      },
    });

    chartRef.current = chart;

    // Add appropriate series
    if (chartType === "candles") {
      const candleSeries = chart.addSeries(CandlestickSeries, {
        upColor: "#10b981",
        downColor: "#f43f5e",
        borderVisible: false,
        wickUpColor: "#10b981",
        wickDownColor: "#f43f5e",
      });

      const candleData = bars.map((b) => ({
        time: b.time,
        open: b.open ?? b.close,
        high: b.high ?? b.close,
        low: b.low ?? b.close,
        close: b.close,
      }));

      candleSeries.setData(candleData);
      seriesRef.current = candleSeries;
    } else {
      const lineSeries = chart.addSeries(LineSeries, {
        color: "#14b8a6",
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBackgroundColor: "#14b8a6",
      });

      const lineData = bars.map((b) => ({
        time: b.time,
        value: b.close,
      }));

      lineSeries.setData(lineData);
      seriesRef.current = lineSeries;
    }

    // Fit content
    if (bars.length > 0) {
      chart.timeScale().fitContent();
    }

    // Crosshair listener for tooltip
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setHovered(null);
        return;
      }

      const timeStr = typeof param.time === "string" ? param.time : "";
      if (!timeStr) {
        setHovered(null);
        return;
      }

      const entry = barsMap.get(timeStr);
      if (!entry) {
        setHovered(null);
        return;
      }

      const { bar, prevClose } = entry;
      const changePct =
        prevClose && prevClose > 0 ? ((bar.close - prevClose) / prevClose) * 100 : null;

      setHovered({
        time: bar.time,
        close: bar.close,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        volume: bar.volume,
        changePct,
      });
    });

    // Resize observer
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
    };
  }, [bars, chartType, height, barsMap]);

  if (bars.length === 0) {
    return (
      <div
        style={{ height }}
        className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-6 text-center text-zinc-500"
      >
        <p className="text-sm font-medium">Sin datos para graficar</p>
        <p className="mt-1 text-xs text-zinc-600">
          Probá cargando el histórico o seleccionando otro rango de fechas.
        </p>
      </div>
    );
  }

  // Active or latest point for info header
  const latestBar = bars[bars.length - 1]!;
  const prevToLatestClose = bars.length > 1 ? bars[bars.length - 2]!.close : null;
  const latestChangePct =
    prevToLatestClose && prevToLatestClose > 0
      ? ((latestBar.close - prevToLatestClose) / prevToLatestClose) * 100
      : null;

  const currentDisplay = hovered ?? {
    time: latestBar.time,
    close: latestBar.close,
    open: latestBar.open,
    high: latestBar.high,
    low: latestBar.low,
    volume: latestBar.volume,
    changePct: latestChangePct,
  };

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

        {/* OHLC & Volume pills when candles or hovered */}
        {chartType === "candles" && currentDisplay.open !== null && (
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

      {/* Chart Canvas */}
      <div className="mt-2 w-full" ref={containerRef} style={{ height }} />
    </div>
  );
}
