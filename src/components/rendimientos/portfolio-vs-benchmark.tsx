"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
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
  formatSignedPercentOrEmpty,
  formatSignedPercentValue,
} from "@/components/rendimientos/chart-utils";
import { LegendRow, LegendToggle } from "@/components/rendimientos/legend-toggle";
import { formatMonthLabel } from "@/lib/rendimientos/months";
import type { BenchmarkKey, BenchmarkSeries, ViewCurrency } from "@/lib/rendimientos/types";
import { benchmarkCumulativeKey, type MonthlyChartRow } from "@/lib/rendimientos/view";

const HEIGHT = 320;

/**
 * Rendimiento acumulado del portfolio contra sus benchmarks.
 *
 * Reemplaza la versión anterior en base 100 por porcentaje acumulado: es la misma
 * información pero legible sin traducir mentalmente ("+22 %" en vez de "base 122"), y
 * permite superponer varios benchmarks en la misma escala.
 *
 * El acumulado está **encadenado** (`Π (1 + Rₘ) − 1`), no sumado, y se recalcula
 * dentro del período visible: si el usuario elige 6 meses, la línea arranca en 0 % en
 * el primer mes de esa ventana.
 */
export function PortfolioVsBenchmark({
  data,
  benchmarks,
  currency,
}: {
  data: MonthlyChartRow[];
  benchmarks: BenchmarkSeries[];
  currency: ViewCurrency;
}) {
  const [hiddenPortfolio, setHiddenPortfolio] = useState(false);
  const [hidden, setHidden] = useState<Set<BenchmarkKey>>(new Set());

  const toggle = (key: BenchmarkKey) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const visible = benchmarks.filter((series) => !hidden.has(series.key));

  return (
    <ChartCard
      title="Rendimiento acumulado"
      description={`Encadenado desde el inicio del período seleccionado (${currency}).`}
      headerExtra={
        <LegendRow>
          <LegendToggle
            color={SERIES_COLORS.portfolio}
            label="Tu portfolio"
            active={!hiddenPortfolio}
            onClick={() => setHiddenPortfolio((value) => !value)}
          />
          {benchmarks.map((series) => (
            <LegendToggle
              key={series.key}
              color={series.color}
              label={series.label}
              active={!hidden.has(series.key)}
              onClick={() => toggle(series.key)}
              hint={
                series.lastAvailableMonth
                  ? `${series.label}: último dato publicado ${formatMonthLabel(series.lastAvailableMonth)}.`
                  : `${series.label}: sin datos en el período.`
              }
            />
          ))}
        </LegendRow>
      }
    >
      {data.length < 2 ? (
        <ChartPlaceholder
          height={HEIGHT}
          text="Se necesitan al menos dos meses de historia para comparar rendimientos."
        />
      ) : (
        <div className="w-full" style={{ height: HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
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
                domain={["auto", "auto"]}
              />
              <ReferenceLine y={0} stroke="#52525b" strokeDasharray="4 4" />
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
                        ...(hiddenPortfolio
                          ? []
                          : [
                              {
                                label: "Tu portfolio",
                                color: SERIES_COLORS.portfolio,
                                value: formatSignedPercentOrEmpty(row.cumulativeReturn),
                              },
                            ]),
                        ...visible.map((series) => ({
                          label: series.label,
                          color: series.color,
                          value: formatSignedPercentOrEmpty(
                            (row[benchmarkCumulativeKey(series.key)] as number | null) ?? null
                          ),
                        })),
                      ]}
                    />
                  );
                }}
              />
              {hiddenPortfolio ? null : (
                <Line
                  type="monotone"
                  dataKey="cumulativeReturn"
                  name="Tu portfolio"
                  stroke={SERIES_COLORS.portfolio}
                  strokeWidth={2.5}
                  dot={{ r: 2.5, fill: SERIES_COLORS.portfolio, strokeWidth: 0 }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
              {visible.map((series) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={benchmarkCumulativeKey(series.key)}
                  name={series.label}
                  stroke={series.color}
                  strokeWidth={1.75}
                  dot={{ r: 2, fill: series.color, strokeWidth: 0 }}
                  // Sin connectNulls: si la fuente dejó de publicar, la línea se corta
                  // ahí en vez de inventar una continuidad que no existe.
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}
