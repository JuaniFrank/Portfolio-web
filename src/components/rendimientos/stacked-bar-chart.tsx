"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts'

export interface StackedData {
  period: string;
  [key: string]: number | string;
}
interface StackProps {
  data: StackedData[]
  categories: string[] // asset names to stack
  title?: string
}
const COLORS = ["#4f46e5", "#10b981", "#6366f1", "#f59e0b", "#f43f5e", "#3b82f6"]
export default function StackedBarChart({ data, categories, title }: StackProps) {
  return (
    <div className="w-full h-[400px]">
      {title && <h3 className="text-lg font-medium mb-2">{title}</h3>}
      <BarChart width={800} height={350} data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="period" tickFormatter={(t) => t.substring(0, 4)} />
        <YAxis />
        <Tooltip />
        <Legend verticalAlign="top" height={36} />
        {categories.map((k, i) => (
          <Bar key={k} dataKey={k as keyof StackedData} stackId="a" fill={COLORS[i % COLORS.length]} name={k} />
        ))}
      </BarChart>
    </div>
  )
}
