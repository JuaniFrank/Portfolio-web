"use client";

import { LineChart, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Line } from "recharts";

export interface RendimientosData {
  date: string;
  portfolioValue: number;
  sp500Close: number | null;
}

interface ChartProps {
  data: RendimientosData[];
}

export default function RendimientosChart({ data }: ChartProps) {
  return (
    <LineChart width={800} height={400} data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="date" tickFormatter={(t) => t.substring(5)} />
      <YAxis />
      <Tooltip />
      <Legend verticalAlign="top" height={36} />
      <Line type="monotone" dataKey="portfolioValue" name="Mi Portafolio (ARS)" stroke="#4f46e5" dot={false} />
      <Line type="monotone" dataKey="sp500Close" name="S&P 500" stroke="#10b981" dot={false} />
    </LineChart>
  );
}
