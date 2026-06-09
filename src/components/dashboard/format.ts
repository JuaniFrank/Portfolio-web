export type ViewCurrency = "ARS" | "USD";

export function formatMoney(value: string | number, currency: ViewCurrency): string {
  const n = typeof value === "number" ? value : Number(value);
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

export function formatCompact(value: string | number, currency: ViewCurrency): string {
  const n = typeof value === "number" ? value : Number(value);
  const formatter = new Intl.NumberFormat("es-AR", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const symbol = currency === "USD" ? "U$S " : "$";
  return `${symbol}${formatter.format(n)}`;
}

export function formatPercent(value: string | number, digits = 2): string {
  const n = typeof value === "number" ? value : Number(value);
  return `${n.toLocaleString("es-AR", { maximumFractionDigits: digits })}%`;
}

export function formatSignedPercent(value: string | number, digits = 2): string {
  const n = typeof value === "number" ? value : Number(value);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("es-AR", { maximumFractionDigits: digits })}%`;
}

export const CHART_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#f59e0b",
  "#f97316",
  "#6366f1",
  "#10b981",
  "#eab308",
  "#a855f7",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#22d3ee",
  "#f43f5e",
  "#14b8a6",
  "#8b5cf6",
  "#fb7185",
];

export const SECTOR_COLORS: Record<string, string> = {
  "Energía": "#14b8a6",
  "Consumo básico": "#a855f7",
  Finanzas: "#ec4899",
  "Consumo discrecional": "#ef4444",
  Tecnología: "#f97316",
  Comunicación: "#06b6d4",
  "Servicios públicos": "#eab308",
  Materiales: "#84cc16",
  Industria: "#3b82f6",
  Salud: "#10b981",
  "Real Estate": "#f59e0b",
  "Renta fija": "#6366f1",
  "Fondos comunes": "#8b5cf6",
  Cripto: "#fb7185",
  ETF: "#22d3ee",
  "Sin clasificar": "#71717a",
};

export const MARKET_COLORS: Record<string, string> = {
  CEDEAR: "#a855f7",
  Locales: "#fb7185",
  Externos: "#3b82f6",
  Cripto: "#f97316",
  Otros: "#71717a",
};
