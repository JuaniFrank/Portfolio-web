"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import type { BenchmarkKey, BenchmarkSeries, ViewCurrency } from "@/lib/rendimientos/types";
import { benchmarkMonthlyKey, type MonthlyChartRow } from "@/lib/rendimientos/view";
import { formatMonthLabel } from "@/lib/rendimientos/months";

const HEIGHT = 300;

/**
 * Rendimiento mes a mes, con los benchmarks al lado en la misma escala.
 *
 * Las barras del portfolio se colorean por signo; las de benchmark usan el color de
 * su serie. Un mes sin rendimiento medible no dibuja barra (no dibuja una barra en
 * cero, que se leería como "no ganó ni perdió" en vez de "no se puede medir").
 */
export function MonthlyReturnChart({
  data,
  benchmarks,
  currency,
}: {
  data: MonthlyChartRow[];
  benchmarks: BenchmarkSeries[];
  currency: ViewCurrency;
}) {
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
      title="Rendimiento mensual"
      description={`Modified cada tramo se mide contra el capital que realmente había invertido (${currency}).`}
      headerExtra={
        benchmarks.length > 0 ? (
          <LegendRow>
            {benchmarks.map((series) => (
              <LegendToggle
                key={series.key}
                color={series.color}
                label={series.label}
                active={!hidden.has(series.key)}
                onClick={() => toggle(series.key)}
                hint={benchmarkHint(series)}
              />
            ))}
          </LegendRow>
        ) : null
      }
    >
      {data.length === 0 ? (
        <ChartPlaceholder height={HEIGHT} text="Todavía no hay meses con rendimiento calculable." />
      ) : (
        <div className="w-full" style={{ height: HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 12, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="month"
                tickFormatter={formatMonthTick}
                tick={{ fill: "#a1a1aa", fontSize: 11 }}
                axisLine={{ stroke: "#71717a" }}
                tickLine={false}
                minTickGap={16}
              />
              <YAxis
                tickFormatter={(value: number) => formatSignedPercentValue(value)}
                tick={{ fill: "#a1a1aa", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={58}
              />
              <ReferenceLine y={0} stroke="#52525b" />
              <Tooltip
                cursor={{ fill: "#27272a", fillOpacity: 0.35 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as MonthlyChartRow | undefined;
                  if (!row) return null;
                  return (
                    <MonthTooltip
                      month={label}
                      entries={[
                        {
                          label: "Tu portfolio",
                          color:
                            (row.monthlyReturn ?? 0) >= 0
                              ? SERIES_COLORS.positive
                              : SERIES_COLORS.negative,
                          value: formatSignedPercentOrEmpty(row.monthlyReturn),
                        },
                        ...visible.map((series) => ({
                          label: series.label,
                          color: series.color,
                          value: formatSignedPercentOrEmpty(
                            (row[benchmarkMonthlyKey(series.key)] as number | null) ?? null
                          ),
                        })),
                      ]}
                    />
                  );
                }}
              />
              <Bar dataKey="monthlyReturn" name="Tu portfolio" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {data.map((row) => (
                  <Cell
                    key={row.month}
                    fill={
                      (row.monthlyReturn ?? 0) >= 0
                        ? SERIES_COLORS.positive
                        : SERIES_COLORS.negative
                    }
                  />
                ))}
              </Bar>
              {visible.map((series) => (
                <Bar
                  key={series.key}
                  dataKey={benchmarkMonthlyKey(series.key)}
                  name={series.label}
                  fill={series.color}
                  isAnimationActive={false}
                  radius={[2, 2, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartCard>
  );
}

/**
 * Aviso de lag de publicación.
 *
 * El INDEC publica la inflación con ~1,5 meses de atraso, así que los últimos meses
 * del gráfico no tienen barra de inflación. Sin este aviso se lee como "no hubo
 * inflación", que es exactamente la conclusión opuesta a la correcta.
 */
function benchmarkHint(series: BenchmarkSeries): string | undefined {
  if (!series.lastAvailableMonth) return `${series.label}: sin datos en el período.`;
  return `${series.label}: último dato publicado ${formatMonthLabel(series.lastAvailableMonth)}.`;
}
