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
  // Yahoo Finance — sectores
  Tecnología: "#3b82f6", // Azul — tecnología, innovación
  "Servicios financieros": "#16a34a", // Verde — dinero, crecimiento
  Industria: "#64748b", // Gris acero — industria, maquinaria
  Salud: "#10b981", // Verde/teal — salud, bienestar
  Comunicación: "#a855f7", // Violeta — medios, comunicación
  "Consumo cíclico": "#f97316", // Naranja — retail, ocio, consumo
  Energía: "#eab308", // Amarillo/ámbar — petróleo, energía, electricidad
  "Consumo defensivo": "#84cc16", // Verde lima — alimentos, básicos
  "Materiales básicos": "#a16207", // Marrón/dorado — minería, metales, químicos
  Inmobiliario: "#c2410c", // Terracota — propiedades, construcción
  "Servicios públicos": "#06b6d4", // Cyan/azul — agua, gas, electricidad

  // Instrumentos que no son sectores de Yahoo
  "Renta fija": "#6366f1", // Índigo — bonos
  "Fondos comunes": "#8b5cf6", // Violeta — fondos
  Cripto: "#f59e0b", // Ámbar — crypto
  ETF: "#0891b2", // Azul/cyan — ETFs
  "Sin clasificar": "#71717a", // Gris — desconocido
};

export const MARKET_COLORS: Record<string, string> = {
  CEDEAR: "#a855f7",
  Locales: "#fb7185",
  Externos: "#3b82f6",
  Cripto: "#f97316",
  Otros: "#71717a",
};
