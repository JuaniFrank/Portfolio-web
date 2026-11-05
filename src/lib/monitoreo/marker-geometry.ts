export type MarkerShape = "tick" | "triangle-up" | "triangle-down";

export interface MarkerGeometry {
  shape: MarkerShape;
  /** Visual width in px (a tick is exactly one candle wide) */
  width: number;
  /** Visual height in px */
  height: number;
  /** Dark ring thickness in px (0 = none) */
  ringWidth: number;
  /** Invisible hover target size in px; may exceed the visual */
  hitSize: number;
}

const MIN_SIZE = 4;
const MAX_SIZE = 12;
const NO_RING_BELOW = 6;
const TICK_HEIGHT = 2;
const MIN_HIT_SIZE = 12;

/** Marker visual derived from the chart's candle body width (klinecharts `getBarSpace().bar`). */
export function markerGeometry(barWidth: number, side: "buy" | "sell"): MarkerGeometry {
  if (!Number.isFinite(barWidth) || barWidth < MIN_SIZE) {
    const width = Number.isFinite(barWidth) ? Math.max(1, barWidth) : 1;
    return { shape: "tick", width, height: TICK_HEIGHT, ringWidth: 0, hitSize: MIN_HIT_SIZE };
  }
  const size = Math.min(MAX_SIZE, barWidth);
  return {
    shape: side === "buy" ? "triangle-up" : "triangle-down",
    width: size,
    height: size,
    ringWidth: size < NO_RING_BELOW ? 0 : 1,
    hitSize: Math.max(MIN_HIT_SIZE, size),
  };
}
