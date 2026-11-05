import { formatCurrency, formatPercent, formatVolume } from "@/components/monitoreo/format";

const DAY_MS = 86_400_000;

export interface MeasurePoint {
  timestamp: number;
  value: number;
}

export interface MeasureBar {
  timestamp: number;
  volume?: number | null;
}

export interface MeasureStats {
  /** B - A (signed, in the direction of the measure, not of time). */
  priceChange: number;
  /** Percentage change relative to A; null when A is not positive. */
  pricePct: number | null;
  /** Bars from the earlier point to the later one, TradingView style: the starting bar is not counted. */
  barsCount: number;
  /** Absolute calendar span in whole days. */
  spanDays: number;
  /** Sum of volume over the bars in the range (both ends inclusive); null when there is none. */
  volume: number | null;
  direction: "up" | "down";
}

/**
 * Stats for a TradingView-like "date and price range" measure. Time stats are symmetric
 * (B before A gives the same bars/span/volume); price stats keep the A -> B sign.
 */
export function computeMeasure(a: MeasurePoint, b: MeasurePoint, bars: readonly MeasureBar[]): MeasureStats {
  const lo = Math.min(a.timestamp, b.timestamp);
  const hi = Math.max(a.timestamp, b.timestamp);
  const priceChange = b.value - a.value;

  let barsCount = 0;
  let volume = 0;
  let hasVolume = false;
  for (const bar of bars) {
    if (bar.timestamp < lo || bar.timestamp > hi) continue;
    if (bar.timestamp > lo) barsCount += 1;
    if (typeof bar.volume === "number" && Number.isFinite(bar.volume)) {
      volume += bar.volume;
      hasVolume = true;
    }
  }

  return {
    priceChange,
    pricePct: a.value > 0 ? (priceChange / a.value) * 100 : null,
    barsCount,
    spanDays: Math.round((hi - lo) / DAY_MS),
    volume: hasVolume ? volume : null,
    direction: priceChange >= 0 ? "up" : "down",
  };
}

/** Label lines (es-AR): price change, bars + span, and volume when available. */
export function formatMeasureLines(stats: MeasureStats, currency: "ARS" | "USD"): string[] {
  const sign = stats.priceChange > 0 ? "+" : stats.priceChange < 0 ? "-" : "";
  const abs = formatCurrency(Math.abs(stats.priceChange), currency);
  const pct = stats.pricePct === null ? "" : ` (${formatPercent(stats.pricePct)})`;
  const lines = [
    `${sign}${abs}${pct}`,
    `${stats.barsCount} ${stats.barsCount === 1 ? "vela" : "velas"}, ${stats.spanDays} d`,
  ];
  if (stats.volume !== null) lines.push(`Vol ${formatVolume(stats.volume)}`);
  return lines;
}
