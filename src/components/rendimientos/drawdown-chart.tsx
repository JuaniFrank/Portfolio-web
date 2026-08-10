"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard } from "@/components/dashboard/chart-card";
import { ChartPlaceholder, MonthTooltip } from "@/components/rendimientos/chart-tooltip";
import {
  SERIES_COLORS,
  formatMonthTick,
  formatSignedPercentValue,
} from "@/components/rendimientos/chart-utils";
import type { MonthlyChartRow } from "@/lib/rendimientos/view";

const HEIGHT = 220;

/**
 * Caída del rendimiento acumulado desde su mejor momento.
 *
 * Calculado sobre el **índice de rendimiento**, no sobre el valor de la cartera. Es una
 * corrección importante sobre la versión anterior: medir drawdown sobre el valor hace
 * que un retiro parezca una pérdida — si sacás la mitad de la plata el valor cae 50 % y
 * el gráfico reportaba −50 % sin que hayas perdido un peso. Sobre el acumulado (que ya
 * neutraliza los flujos) mide lo que dice medir.
 */
export function DrawdownChart({ data }: { data: MonthlyChartRow[] }) {
  return (
    <ChartCard
      title="Drawdown"
      description="Caída del rendimiento acumulado desde su máximo. Neutraliza aportes y retiros."
      headerExtra={<span className="text-xs text-rose-400">Riesgo</span>}
    >
      {data.length < 2 ? (
        <ChartPlaceholder
          height={HEIGHT}
          text="Se necesitan al menos dos meses de historia para visualizar el drawdown."
        />
      ) : (
        <div className="w-full" style={{ height: HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_COLORS.drawdown} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={SERIES_COLORS.drawdown} stopOpacity={0.45} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={formatMonthTick}
                tick={{ fill: "#a1a1aa", fontSize: 11 }}
                axisLine={{ stroke: "#71717a" }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(value: number) => formatSignedPercentValue(value)}
                tick={{ fill: "#a1a1aa", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={58}
                domain={["auto", 0]}
              />
              <Tooltip
                cursor={{ stroke: "#52525b" }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as MonthlyChartRow | undefined;
                  if (!row) return null;
                  return (
                    <MonthTooltip
                      month={label}
                      entries={[
                        {
                          label: "Drawdown",
                          color: SERIES_COLORS.drawdown,
                          value: formatSignedPercentValue(row.drawdown),
                        },
                      ]}
                    />
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="drawdown"
                name="Drawdown"
                stroke={SERIES_COLORS.drawdown}
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
