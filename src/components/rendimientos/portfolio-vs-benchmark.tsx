"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/dashboard/chart-card";
import { formatDateTick, formatPercentValue, formatSignedPercentValue } from "@/components/rendimientos/chart-utils";
import type { ChartPoint } from "@/lib/rendimientos/types";

type Props = {
  data: ChartPoint[];
  benchmarkAvailable: boolean;
};

export function PortfolioVsBenchmark({ data, benchmarkAvailable }: Props) {
  const [visible, setVisible] = useState({ portfolio: true, benchmark: true });

  return (
    <ChartCard
      title="Portfolio vs S&P 500"
      description="Evolución normalizada a base 100 dentro del período seleccionado."
      headerExtra={
        <div className="flex items-center gap-3 text-xs">
          <LegendButton
            color="#6366f1"
            label="Portfolio"
            active={visible.portfolio}
            onClick={() => setVisible((state) => ({ ...state, portfolio: !state.portfolio }))}
          />
          {benchmarkAvailable ? (
            <LegendButton
              color="#10b981"
              label="S&P 500"
              active={visible.benchmark}
              onClick={() => setVisible((state) => ({ ...state, benchmark: !state.benchmark }))}
            />
          ) : null}
        </div>
      }
    >
      {data.length < 2 ? (
        <ChartPlaceholder text="Se necesitan al menos dos snapshots para comparar evolución." />
      ) : (
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="portfolioIndexGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="benchmarkIndexGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatDateTick}
                tick={{ fill: "#a1a1aa", fontSize: 11 }}
                axisLine={{ stroke: "#71717a" }}
                tickLine={false}
                minTickGap={36}
              />
              <YAxis
                tickFormatter={(value: number) => `${Math.round(value)}`}
                tick={{ fill: "#a1a1aa", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={38}
                domain={["auto", "auto"]}
              />
              <Tooltip content={<BenchmarkTooltip />} cursor={{ stroke: "#52525b" }} />
              {visible.portfolio ? (
                <Area
                  type="monotone"
                  dataKey="portfolioIndex"
                  name="Portfolio"
                  stroke="#6366f1"
                  fill="url(#portfolioIndexGradient)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ) : null}
              {visible.benchmark && benchmarkAvailable ? (
                <Area
                  type="monotone"
                  dataKey="benchmarkIndex"
                  name="S&P 500"
                  stroke="#10b981"
                  fill="url(#benchmarkIndexGradient)"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ) : null}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function LegendButton({
  color,
  label,
  active,
  onClick,
}: {
  color: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 transition-colors ${active ? "text-zinc-300" : "text-zinc-600 line-through"}`}
      aria-pressed={active}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </button>
  );
}

function BenchmarkTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#27272a] bg-[#09090b] p-3 text-xs shadow-xl">
      <p className="mb-2 text-zinc-500">{typeof label === "string" ? formatDateTick(label) : label}</p>
      {payload.map((item) => (
        <div key={item.name} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.name}
          </span>
          <span className="font-medium tabular-nums text-zinc-100">
            Base {formatPercentValue(Number(item.value))}
            <span className="ml-1 text-zinc-500">
              ({formatSignedPercentValue(Number(item.value) - 100)})
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function ChartPlaceholder({ text }: { text: string }) {
  return <div className="flex h-[320px] items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">{text}</div>;
}
