"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardHolding } from "@/lib/dashboard/types";
import { CHART_COLORS, formatCompact, formatMoney, formatPercent, type ViewCurrency } from "./format";

type Props = {
  holdings: DashboardHolding[];
  currency: ViewCurrency;
};

export function ValueByTickerBars({ holdings, currency }: Props) {
  const data = useMemo(
    () =>
      holdings.map((h, i) => ({
        ticker: h.ticker,
        value: Number(currency === "ARS" ? h.marketValueArs : h.marketValueUsd),
        percent: h.weightPercent,
        pnlPercent: h.pnlPercent,
        color: CHART_COLORS[i % CHART_COLORS.length]!,
      })),
    [holdings, currency]
  );

  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-md border border-dashed border-zinc-800 text-sm text-zinc-500">
        Sin posiciones para mostrar.
      </div>
    );
  }

  return (
    <div className="h-[360px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 24, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis
            dataKey="ticker"
            stroke="#71717a"
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={{ stroke: "#27272a" }}
            interval={0}
            angle={data.length > 12 ? -30 : 0}
            height={data.length > 12 ? 50 : 28}
            textAnchor={data.length > 12 ? "end" : "middle"}
          />
          <YAxis
            stroke="#71717a"
            tick={{ fontSize: 11, fill: "#a1a1aa" }}
            tickLine={false}
            axisLine={{ stroke: "#27272a" }}
            tickFormatter={(v: number) => formatCompact(v, currency)}
            width={72}
          />
          <Tooltip
            cursor={{ fill: "#27272a44" }}
            contentStyle={{
              background: "#09090b",
              border: "1px solid #27272a",
              borderRadius: 8,
              fontSize: 12,
              padding: "8px 10px",
            }}
            labelStyle={{ color: "#fafafa", fontWeight: 600 }}
            formatter={(value, _name, item) => {
              const pct = item?.payload?.percent ?? "0";
              const pnl = item?.payload?.pnlPercent ?? "0";
              return [
                `${formatMoney(Number(value ?? 0), currency)} · ${formatPercent(pct)} del portfolio · PnL ${formatPercent(pnl)}`,
                "Valuación",
              ];
            }}
          />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            <LabelList
              dataKey="value"
              position="top"
              formatter={(v: unknown) => formatCompact(Number(v ?? 0), currency)}
              style={{ fill: "#a1a1aa", fontSize: 10, fontWeight: 600 }}
            />
            {data.map((d, i) => (
              <Cell key={d.ticker + i} fill={d.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
