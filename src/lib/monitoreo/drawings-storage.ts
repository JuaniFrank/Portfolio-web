import type { UiMonitoringSeriesKind } from "./types";

/** Points each klinecharts built-in overlay needs (its `totalStep` minus one). */
export const DRAWING_POINTS_REQUIRED = {
  segment: 2,
  rayLine: 2,
  horizontalStraightLine: 1,
  priceLine: 1,
  parallelStraightLine: 3,
  fibonacciLine: 2,
  simpleAnnotation: 1,
} as const;

export type DrawingToolName = keyof typeof DRAWING_POINTS_REQUIRED;

export interface StoredDrawing {
  name: DrawingToolName;
  points: { timestamp: number; value: number }[];
  /** Annotation text */
  text?: string;
}

export function drawingsStorageKey(ticker: string, kind: UiMonitoringSeriesKind): string {
  return `activos:drawings:v1:${ticker.toUpperCase()}:${kind}`;
}

function isToolName(name: unknown): name is DrawingToolName {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(DRAWING_POINTS_REQUIRED, name);
}

function normalize(input: unknown): StoredDrawing | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as { name?: unknown; points?: unknown; text?: unknown; extendData?: unknown };
  if (!isToolName(raw.name) || !Array.isArray(raw.points)) return null;
  const points: StoredDrawing["points"] = [];
  for (const p of raw.points) {
    const point = p as { timestamp?: unknown; value?: unknown } | null;
    if (
      !point ||
      typeof point.timestamp !== "number" ||
      typeof point.value !== "number" ||
      !Number.isFinite(point.timestamp) ||
      !Number.isFinite(point.value)
    ) {
      return null;
    }
    points.push({ timestamp: point.timestamp, value: point.value });
  }
  if (points.length !== DRAWING_POINTS_REQUIRED[raw.name]) return null;
  const text =
    typeof raw.text === "string" ? raw.text : typeof raw.extendData === "string" ? raw.extendData : undefined;
  return text !== undefined && raw.name === "simpleAnnotation"
    ? { name: raw.name, points, text }
    : { name: raw.name, points };
}

/** Accepts loose overlay-like objects (points may be partial); invalid ones are dropped. */
export function serializeDrawings(drawings: unknown[]): string {
  return JSON.stringify(drawings.map(normalize).filter((d): d is StoredDrawing => d !== null));
}

export function parseDrawings(raw: string | null): StoredDrawing[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize).filter((d): d is StoredDrawing => d !== null);
  } catch {
    return [];
  }
}
