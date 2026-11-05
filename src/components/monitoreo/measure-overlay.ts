import type { OverlayFigure, OverlayTemplate } from "klinecharts";
import { computeMeasure, formatMeasureLines } from "@/lib/monitoreo/measure";
import type { MonitoringCurrency } from "@/lib/monitoreo/types";

/** Overlay name of the TradingView-style ruler (never one of the persisted drawing tools). */
export const MEASURE_OVERLAY_NAME = "measure";
/** Group id keeping the ruler apart from user drawings (which are persisted). */
export const MEASURE_GROUP = "measure-ruler";

export interface MeasureExtendData {
  currency: MonitoringCurrency;
}

const COLORS = {
  up: { fill: "rgba(16, 185, 129, 0.18)", line: "#10b981", label: "#065f46" },
  down: { fill: "rgba(244, 63, 94, 0.18)", line: "#f43f5e", label: "#9f1239" },
} as const;

const ARROW_HEAD_PX = 6;
const LABEL_LINE_PX = 18;
const LABEL_GAP_PX = 10;

function arrow(from: { x: number; y: number }, to: { x: number; y: number }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [];
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(ARROW_HEAD_PX, len / 2);
  const wing = (sign: number) => ({
    x: to.x - (ux * Math.cos(0.5) - sign * uy * Math.sin(0.5)) * head,
    y: to.y - (uy * Math.cos(0.5) + sign * ux * Math.sin(0.5)) * head,
  });
  return [
    { coordinates: [from, to] },
    { coordinates: [wing(1), to, wing(-1)] },
  ];
}

export const measureOverlayTemplate: OverlayTemplate<MeasureExtendData> = {
  name: MEASURE_OVERLAY_NAME,
  totalStep: 3,
  needDefaultPointFigure: true,
  needDefaultXAxisFigure: true,
  needDefaultYAxisFigure: true,
  createPointFigures: ({ chart, overlay, coordinates, bounding }) => {
    const [pa, pb] = overlay.points;
    if (coordinates.length < 2 || !pa || !pb) return [];
    if (
      typeof pa.timestamp !== "number" ||
      typeof pa.value !== "number" ||
      typeof pb.timestamp !== "number" ||
      typeof pb.value !== "number"
    ) {
      return [];
    }
    const [ca, cb] = coordinates;
    if (!ca || !cb) return [];
    const stats = computeMeasure(
      { timestamp: pa.timestamp, value: pa.value },
      { timestamp: pb.timestamp, value: pb.value },
      chart.getDataList()
    );
    const palette = COLORS[stats.direction];
    const currency = overlay.extendData?.currency ?? "ARS";
    const lines = formatMeasureLines(stats, currency);

    const left = Math.min(ca.x, cb.x);
    const top = Math.min(ca.y, cb.y);
    const width = Math.abs(cb.x - ca.x);
    const height = Math.abs(cb.y - ca.y);
    const midX = left + width / 2;
    const midY = top + height / 2;

    // Label next to B: on the side B moved away from A, flipped when it would leave the pane.
    const goingRight = cb.x >= ca.x;
    const alignRight = goingRight ? cb.x + LABEL_GAP_PX + 150 > bounding.width : false;
    const labelX = alignRight || !goingRight ? cb.x - LABEL_GAP_PX : cb.x + LABEL_GAP_PX;
    const align = alignRight || !goingRight ? "right" : "left";
    const blockHeight = lines.length * LABEL_LINE_PX;
    const goingUp = cb.y <= ca.y;
    const rawTop = goingUp ? cb.y - LABEL_GAP_PX - blockHeight : cb.y + LABEL_GAP_PX;
    const labelTop = Math.min(Math.max(rawTop, 2), Math.max(2, bounding.height - blockHeight - 2));

    const figures: OverlayFigure[] = [
      {
        type: "rect",
        ignoreEvent: true,
        attrs: { x: left, y: top, width, height },
        styles: { style: "fill", color: palette.fill },
      },
      {
        type: "line",
        ignoreEvent: true,
        attrs: [
          ...arrow({ x: left, y: midY }, { x: left + width, y: midY }),
          ...arrow({ x: midX, y: ca.y }, { x: midX, y: cb.y }),
        ],
        styles: { color: palette.line, size: 1.5 },
      },
      {
        type: "text",
        ignoreEvent: true,
        attrs: lines.map((text, i) => ({
          x: labelX,
          y: labelTop + i * LABEL_LINE_PX,
          text,
          align,
          baseline: "top",
        })),
        styles: {
          style: "fill",
          color: "#f4f4f5",
          size: 11,
          backgroundColor: palette.label,
          borderRadius: 2,
          paddingLeft: 6,
          paddingRight: 6,
          paddingTop: 2,
          paddingBottom: 2,
        },
      },
    ];
    return figures;
  },
};
