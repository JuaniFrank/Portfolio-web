"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DividendByMonth, DividendByTicker } from "@/lib/dividends/types";
import { formatMoney, type ViewCurrency } from "./format";

type Props = {
  byMonth: DividendByMonth[];
  byTicker: DividendByTicker[];
  currency: ViewCurrency;
  cclToday?: string | null;
};

const PIE_COLORS = [
  "#10b981",
  "#3b82f6",
  "#a855f7",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#ec4899",
  "#6366f1",
];

export function DividendCharts({ byMonth, byTicker, currency, cclToday }: Props) {
  const isArs = currency === "ARS";
  const ccl = cclToday ? Number(cclToday) : 0;

  const monthData = useMemo(
    () =>
      byMonth.map((m) => {
        if (isArs) {
          const bruto = Number(m.grossArs) + (ccl > 0 ? Number(m.grossUsd) * ccl : 0);
          const retencion = Number(m.taxArs) + (ccl > 0 ? Number(m.taxUsd) * ccl : 0);
          const neto = Number(m.netArs) + (ccl > 0 ? Number(m.netUsd) * ccl : 0);
          return { label: m.label, bruto, retencion, neto };
        } else {
          const bruto = Number(m.grossUsd) + (ccl > 0 ? Number(m.grossArs) / ccl : 0);
          const retencion = Number(m.taxUsd) + (ccl > 0 ? Number(m.taxArs) / ccl : 0);
          const neto = Number(m.netUsd) + (ccl > 0 ? Number(m.netArs) / ccl : 0);
          return { label: m.label, bruto, retencion, neto };
        }
      }),
    [byMonth, isArs, ccl]
  );

  const tickerData = useMemo(() => {
    const rows = byTicker
      .map((t) => {
        let net = 0;
        if (isArs) {
          const usdInArs = ccl > 0 ? Number(t.netUsd) * ccl : 0;
          net = Number(t.netArs) + usdInArs;
        } else {
          const arsInUsd = ccl > 0 ? Number(t.netArs) / ccl : 0;
          net = Number(t.netUsd) + arsInUsd;
        }
        return {
          ticker: t.ticker,
          net,
        };
      })
      .filter((t) => t.net > 0);
    rows.sort((a, b) => b.net - a.net);
    const top = rows.slice(0, 8);
    const restSum = rows.slice(8).reduce((s, r) => s + r.net, 0);
    if (restSum > 0) top.push({ ticker: "Otros", net: restSum });
    return top;
  }, [byTicker, isArs, ccl]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-zinc-100">Evolución mensual</h3>
          <p className="text-xs text-zinc-500">Bruto vs retenciones vs neto recibido</p>
        </div>
        {monthData.length === 0 ? (
          <EmptyChart>Aún no hay pagos recibidos.</EmptyChart>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="label"
                  stroke="#71717a"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "#27272a" }}
                />
                <YAxis
                  stroke="#71717a"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "#27272a" }}
                  tickFormatter={(v: number) => compactNumber(v, currency)}
                  width={70}
                />
                <Tooltip
                  cursor={{ fill: "#27272a55" }}
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value) => formatMoney(Number(value ?? 0), currency)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="bruto" name="Bruto" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="retencion" name="Retención" fill="#f43f5e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="neto" name="Neto" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-zinc-100">Distribución por ticker</h3>
          <p className="text-xs text-zinc-500">% del neto recibido (top 8 + otros)</p>
        </div>
        {tickerData.length === 0 ? (
          <EmptyChart>Aún no hay pagos recibidos.</EmptyChart>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                  formatter={(value) => formatMoney(Number(value ?? 0), currency)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Pie
                  data={tickerData}
                  dataKey="net"
                  nameKey="ticker"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                >
                  {tickerData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]!} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyChart({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-72 items-center justify-center text-sm text-zinc-500">
      {children}
    </div>
  );
}

function compactNumber(value: number, currency: ViewCurrency): string {
  const formatter = new Intl.NumberFormat("es-AR", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const symbol = currency === "USD" ? "U$S " : "$ ";
  return `${symbol}${formatter.format(value)}`;
}
