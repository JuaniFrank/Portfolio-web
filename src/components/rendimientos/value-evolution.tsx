"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard } from "@/components/dashboard/chart-card";
import { formatCompact, formatMoney } from "@/components/dashboard/format";
import { ChartPlaceholder, MonthTooltip } from "@/components/rendimientos/chart-tooltip";
import { SERIES_COLORS, formatMonthTick } from "@/components/rendimientos/chart-utils";
import { LegendRow, LegendToggle } from "@/components/rendimientos/legend-toggle";
import { useChartColors } from "@/components/providers/use-chart-colors";
import type { ViewCurrency } from "@/lib/rendimientos/types";
import type { MonthlyChartRow } from "@/lib/rendimientos/view";

const HEIGHT = 300;

/**
 * Valor invertido contra capital invertido, mes a mes.
 *
 * La distancia entre las dos curvas **es** la ganancia: si el valor va por encima del
 * capital puesto, la cartera generó plata; si va por debajo, la perdió. Es la lectura
 * más directa de "¿me está yendo bien?" y no depende de entender ningún porcentaje.
 *
 * El capital invertido sale de las compras y ventas, no de los depósitos, así que la
 * curva existe aunque el usuario nunca haya cargado un movimiento de efectivo.
 */
export function ValueEvolution({
  data,
  currency,
}: {
  data: MonthlyChartRow[];
  currency: ViewCurrency;
}) {
  const [showFlows, setShowFlows] = useState(true);
  const chartColors = useChartColors();

  return (
    <ChartCard
      title="Evolución del portfolio"
      description="Valor de mercado contra el capital que pusiste (compras − ventas). La brecha entre las curvas es la ganancia."
      headerExtra={
        <LegendRow>
          <LegendToggle
            color={SERIES_COLORS.portfolio}
            label="Valor invertido"
            active
            onClick={() => {}}
          />
          <LegendToggle
            color={SERIES_COLORS.contributions}
            label="Capital invertido"
            active={showFlows}
            onClick={() => setShowFlows((value) => !value)}
          />
        </LegendRow>
      }
    >
      {data.length < 2 ? (
        <ChartPlaceholder
          height={HEIGHT}
          text="Se necesitan al menos dos meses de historia para graficar la evolución."
        />
      ) : (
        <div className="w-full" style={{ height: HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="evolutionGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_COLORS.portfolio} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={SERIES_COLORS.portfolio} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={chartColors.zinc800} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={formatMonthTick}
                tick={{ fill: chartColors.zinc400, fontSize: 11 }}
                axisLine={{ stroke: chartColors.zinc500 }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(value: number) => formatCompact(value, currency)}
                tick={{ fill: chartColors.zinc400, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={76}
              />
              <Tooltip
                cursor={{ stroke: chartColors.zinc600 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as MonthlyChartRow | undefined;
                  if (!row) return null;
                  return (
                    <MonthTooltip
                      month={label}
                      entries={[
                        {
                          label: "Valor invertido",
                          color: SERIES_COLORS.portfolio,
                          value: formatMoney(row.value, currency),
                        },
                        {
                          label: "Capital invertido",
                          color: SERIES_COLORS.contributions,
                          value: formatMoney(row.cumulativeInvested, currency),
                        },
                        {
                          label: "Ganancia del mes",
                          color: row.gain >= 0 ? SERIES_COLORS.positive : SERIES_COLORS.negative,
                          value: formatMoney(row.gain, currency),
                        },
                      ]}
                      footer={
                        row.coverage === "partial"
                          ? "Algún precio de este mes viene por arrastre."
                          : undefined
                      }
                    />
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                name="Valor invertido"
                stroke={SERIES_COLORS.portfolio}
                fill="url(#evolutionGradient)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              {showFlows ? (
                <Line
                  type="monotone"
                  dataKey="cumulativeInvested"
                  name="Capital invertido"
                  stroke={SERIES_COLORS.contributions}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  dot={false}
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
