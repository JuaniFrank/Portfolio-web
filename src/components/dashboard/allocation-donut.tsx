"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { AllocationSlice } from "@/lib/dashboard/types";
import { CHART_COLORS, formatMoney, formatPercent, type ViewCurrency } from "./format";

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
  const slices = useMemo(() => {
    if (!topN || data.length <= topN) {
      return data.map((d, i) => ({ ...d, color: pickColor(d, i, colorMap) }));
    }
    const top = data.slice(0, topN);
    const restItems = data.slice(topN);
    let restValueArs = 0;
    let restValueUsd = 0;
    let restPercent = 0;
    for (const r of restItems) {
      restValueArs += Number(r.valueArs);
      restValueUsd += Number(r.valueUsd);
      restPercent += Number(r.percent);
    }
    return [
      ...top.map((d, i) => ({ ...d, color: pickColor(d, i, colorMap) })),
      {
        key: "__rest__",
        label: "Otros",
        valueArs: restValueArs.toFixed(2),
        valueUsd: restValueUsd.toFixed(2),
        percent: restPercent.toFixed(2),
        color: "#52525b",
      },
    ];
  }, [data, topN, colorMap]);

  const totalValue = useMemo(
    () =>
      slices.reduce(
        (acc, s) => acc + Number(currency === "ARS" ? s.valueArs : s.valueUsd),
        0
      ),
    [slices, currency]
  );

  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (slices.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-zinc-800 text-sm text-zinc-500">
        Sin posiciones para mostrar.
      </div>
    );
  }

  const layout = labelPosition === "side" ? "grid-cols-[1fr_220px]" : "grid-cols-1";

  return (
    <div className={`grid items-center gap-4 lg:${layout}`}>
      <div className="relative h-72">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              contentStyle={{
                background: "#09090b",
                border: "1px solid #27272a",
                borderRadius: 8,
                fontSize: 12,
                padding: "8px 10px",
              }}
              labelStyle={{ color: "#d4d4d8" }}
              formatter={(value, _name, item) => {
                const pct = item?.payload?.percent ?? "0";
                return [
                  `${formatMoney(Number(value ?? 0), currency)} · ${formatPercent(pct)}`,
                  item?.payload?.label,
                ];
              }}
            />
            <Pie
              data={slices}
              dataKey={currency === "ARS" ? "valueArs" : "valueUsd"}
              nameKey="label"
              cx="50%"
              cy="50%"
              outerRadius={110}
              innerRadius={68}
              paddingAngle={1.5}
              stroke="#09090b"
              strokeWidth={2}
              onMouseEnter={(_, idx) => setActiveIndex(idx)}
              onMouseLeave={() => setActiveIndex(null)}
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

type SliceWithColor = AllocationSlice & { color: string };

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
        const value = currency === "ARS" ? s.valueArs : s.valueUsd;
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
              <span className="text-zinc-500">{formatMoney(Number(value), currency)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

