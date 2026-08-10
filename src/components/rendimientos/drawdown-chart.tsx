"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/dashboard/chart-card";
import { formatDateLong, formatDateTick, formatSignedPercentValue } from "@/components/rendimientos/chart-utils";
import type { ChartPoint } from "@/lib/rendimientos/types";

export function DrawdownChart({ data }: { data: ChartPoint[] }) {
  return (
    <ChartCard
      title="Drawdown"
      description="Caída del portfolio desde su máximo histórico dentro del período."
      headerExtra={<span className="text-xs text-rose-400">Riesgo</span>}
    >
      {data.length < 2 ? (
        <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
          Se necesitan al menos dos snapshots para visualizar el drawdown.
        </div>
      ) : (
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.45} />
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
                tickFormatter={(value: number) => formatSignedPercentValue(value)}
                tick={{ fill: "#a1a1aa", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={54}
                domain={["auto", 0]}
              />
              <Tooltip content={<DrawdownTooltip />} cursor={{ stroke: "#52525b" }} />
              <Area
                type="monotone"
                dataKey="drawdown"
                name="Drawdown"
                stroke="#f43f5e"
                fill="url(#drawdownGradient)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

function DrawdownTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#27272a] bg-[#09090b] p-3 text-xs shadow-xl">
      <p className="text-zinc-500">{typeof label === "string" ? formatDateLong(label) : label}</p>
      <p className="mt-1 font-medium tabular-nums text-rose-400">
        {formatSignedPercentValue(Number(payload[0]?.value ?? 0))}
      </p>
    </div>
  );
}
