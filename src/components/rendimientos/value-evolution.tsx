"use client";

import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/dashboard/chart-card";
import { formatCompact, type ViewCurrency } from "@/components/dashboard/format";
import { formatDateLong, formatDateTick } from "@/components/rendimientos/chart-utils";
import type { ChartPoint } from "@/lib/rendimientos/types";

type Props = { data: ChartPoint[]; currency: ViewCurrency };

export function ValueEvolution({ data, currency }: Props) {
  return (
    <ChartCard
      title="Evolución del valor"
      description="Valor de mercado y aportes netos acumulados."
      headerExtra={<span className="text-xs text-amber-400">Aportes netos</span>}
    >
      {data.length < 2 ? (
        <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
          Se necesitan al menos dos snapshots para graficar la evolución.
        </div>
      ) : (
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
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
                tickFormatter={(value: number) => formatCompact(value, currency)}
                tick={{ fill: "#a1a1aa", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={76}
              />
              <Tooltip content={<ValueTooltip currency={currency} />} cursor={{ stroke: "#52525b" }} />
              <Area
                type="monotone"
                dataKey="value"
                name="Valor"
                stroke="#6366f1"
                fill="url(#valueGradient)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="deposits"
                name="Aportes netos"
                stroke="#f59e0b"
                strokeWidth={1.5}
                strokeDasharray="5 4"
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

function ValueTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
  currency: ViewCurrency;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-[#27272a] bg-[#09090b] p-3 text-xs shadow-xl">
      <p className="mb-2 text-zinc-500">{typeof label === "string" ? formatDateLong(label) : label}</p>
      {payload.map((item) => (
        <div key={item.name} className="flex items-center justify-between gap-6 py-0.5">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.name}
          </span>
          <span className="font-medium tabular-nums text-zinc-100">
            {formatCompact(Number(item.value), currency)}
          </span>
        </div>
      ))}
    </div>
  );
}
