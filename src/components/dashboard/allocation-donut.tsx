"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { REST_SLICE_KEY, groupAllocationSlices } from "@/lib/dashboard/allocation-grouping";
import type { AllocationSlice, AllocationSliceDetail } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { CHART_COLORS, formatMoney, formatPercent, type ViewCurrency } from "./format";

const REST_COLOR = "#52525b";

/**
 * Grace period before hiding the tooltip once the pointer leaves a slice. Long enough to
 * cross the gap into the tooltip, so its list can be scrolled.
 */
const TOOLTIP_HIDE_DELAY_MS = 250;
const TOOLTIP_OFFSET = 12;

type TooltipAnchor = { index: number; x: number; y: number; flip: boolean };

type Props = {
  data: AllocationSlice[];
  currency: ViewCurrency;
  colorMap?: Record<string, string>;
  labelPosition?: "side" | "below";
  centerSubtitle?: string;
  /** Posiciones a mostrar antes de agrupar como "Otros". */
  topN?: number;
};

export function AllocationDonut({
  data,
  currency,
  colorMap,
  labelPosition = "side",
  centerSubtitle,
  topN,
}: Props) {
  const slices = useMemo(
    () =>
      groupAllocationSlices(data, topN).map<SliceWithColor>((d, i) => ({
        ...d,
        value: Number(currency === "ARS" ? d.valueArs : d.valueUsd),
        color: d.key === REST_SLICE_KEY ? REST_COLOR : pickColor(d, i, colorMap),
      })),
    [data, topN, colorMap, currency]
  );

  const totalValue = useMemo(
    () => slices.reduce((acc, s) => acc + s.value, 0),
    [slices]
  );

  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<TooltipAnchor | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The tooltip follows the pointer only while it is over a slice. Once it leaves, the
  // tooltip stays put so the pointer can reach it instead of chasing it.
  const overSlice = useRef(false);

  const cancelHide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => {
      setTooltip(null);
      setActiveIndex(null);
    }, TOOLTIP_HIDE_DELAY_MS);
  };

  useEffect(() => cancelHide, []);

  const anchorAt = (index: number, clientX: number, clientY: number): TooltipAnchor | null => {
    const rect = chartRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left;
    return { index, x, y: clientY - rect.top, flip: x > rect.width / 2 };
  };

  const showTooltip = (index: number, event: React.MouseEvent) => {
    overSlice.current = true;
    cancelHide();
    setActiveIndex(index);
    setTooltip(anchorAt(index, event.clientX, event.clientY));
  };

  const followPointer = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!overSlice.current || !tooltip) return;
    setTooltip(anchorAt(tooltip.index, event.clientX, event.clientY));
  };

  const hoveredSlice = tooltip ? slices[tooltip.index] : undefined;

  if (slices.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-zinc-800 text-sm text-zinc-500">
        Sin posiciones para mostrar.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid items-center gap-4",
        labelPosition === "side" ? "lg:grid-cols-[1fr_220px]" : "lg:grid-cols-1"
      )}
    >
      <div ref={chartRef} className="relative h-72" onMouseMove={followPointer}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={110}
              innerRadius={68}
              paddingAngle={1.5}
              stroke="#09090b"
              strokeWidth={2}
              onMouseEnter={(_, idx, event) => showTooltip(idx, event)}
              onMouseLeave={() => {
                overSlice.current = false;
                scheduleHide();
              }}
            >
              {slices.map((s, i) => (
                <Cell
                  key={s.key + i}
                  fill={s.color}
                  fillOpacity={activeIndex === null || activeIndex === i ? 1 : 0.35}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Total
          </p>
          <p className="text-base font-semibold tabular-nums text-zinc-50">
            {formatMoney(totalValue, currency)}
          </p>
          {centerSubtitle ? (
            <p className="mt-0.5 text-[10px] text-zinc-500">{centerSubtitle}</p>
          ) : null}
        </div>
        {tooltip && hoveredSlice ? (
          <div
            className="absolute z-20"
            style={{
              left: tooltip.flip ? tooltip.x - TOOLTIP_OFFSET : tooltip.x + TOOLTIP_OFFSET,
              top: tooltip.y + TOOLTIP_OFFSET,
              transform: tooltip.flip ? "translateX(-100%)" : undefined,
            }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
          >
            <DonutTooltipContent slice={hoveredSlice} currency={currency} />
          </div>
        ) : null}
      </div>

      <Legend
        slices={slices}
        currency={currency}
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
        position={labelPosition}
      />
    </div>
  );
}

function pickColor(slice: AllocationSlice, i: number, map?: Record<string, string>): string {
  if (map && map[slice.label]) return map[slice.label]!;
  return CHART_COLORS[i % CHART_COLORS.length]!;
}

type SliceWithColor = AllocationSlice & { value: number; color: string };

/** Scrollable detail list; `overscroll-contain` keeps the wheel from scrolling the page. */
const DETAIL_LIST_CLASS = "max-h-48 space-y-1 overflow-y-auto overscroll-contain pr-1";

function DonutTooltipContent({
  slice,
  currency,
}: {
  slice: SliceWithColor;
  currency: ViewCurrency;
}) {
  const boxStyle = {
    background: "#09090b",
    border: "1px solid #27272a",
    borderRadius: 8,
    fontSize: 12,
    padding: "8px 10px",
  } as const;

  if (slice.key === REST_SLICE_KEY && slice.details?.length) {
    return (
      <div style={boxStyle} className="space-y-1.5">
        <p className="font-medium text-zinc-100">
          {slice.label} · {formatPercent(slice.percent)}
        </p>
        <ul className={DETAIL_LIST_CLASS}>
          {slice.details.map((d) => (
            <li key={d.key} className="whitespace-nowrap tabular-nums text-zinc-300">
              <DetailLine detail={d} currency={currency} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (slice.details?.length) {
    return (
      <div style={boxStyle} className="space-y-1.5">
        <p className="font-medium text-zinc-100">{slice.label}</p>
        <ul className={DETAIL_LIST_CLASS}>
          {slice.details.map((d) => (
            <li key={d.key} className="whitespace-nowrap tabular-nums text-zinc-300">
              <DetailLine detail={d} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div style={boxStyle}>
      <p className="font-medium text-zinc-100">{slice.label}</p>
      <p className="mt-0.5 tabular-nums text-zinc-300">
        {formatMoney(slice.value, currency)} · {formatPercent(slice.percent)}
      </p>
    </div>
  );
}

function DetailLine({
  detail,
  currency = "USD",
}: {
  detail: AllocationSliceDetail;
  currency?: ViewCurrency;
}) {
  const value = currency === "ARS" ? detail.valueArs : detail.valueUsd;
  return (
    <>
      {detail.label} · {formatPercent(detail.percent)} ·{" "}
      {formatMoney(Number(value), currency)}
    </>
  );
}

function Legend({
  slices,
  currency,
  activeIndex,
  setActiveIndex,
  position,
}: {
  slices: SliceWithColor[];
  currency: ViewCurrency;
  activeIndex: number | null;
  setActiveIndex: (i: number | null) => void;
  position: "side" | "below";
}) {
  const isSide = position === "side";

  return (
    <ul
      className={
        isSide
          ? "max-h-72 space-y-1.5 overflow-y-auto pr-1 text-xs"
          : "mt-2 grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-3 lg:grid-cols-4"
      }
    >
      {slices.map((s, i) => {
        const active = activeIndex === i;
        return (
          <li
            key={s.key + i}
            onMouseEnter={() => setActiveIndex(i)}
            onMouseLeave={() => setActiveIndex(null)}
            className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors ${
              active ? "bg-zinc-800/60" : "hover:bg-zinc-800/30"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: s.color }}
              />
              <span className="truncate font-medium text-zinc-200">{s.label}</span>
            </span>
            <span className="flex items-baseline gap-2 text-right tabular-nums">
              <span className="text-zinc-400">{formatPercent(s.percent)}</span>
              <span className="text-zinc-500">{formatMoney(s.value, currency)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

