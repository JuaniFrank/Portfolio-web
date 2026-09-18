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

export const SECTOR_DESCRIPTIONS: Record<string, string> = {
  // Yahoo Finance — sectores principales

  Technology:
    "Empresas que desarrollan software, hardware, semiconductores y otras soluciones tecnológicas.",

  "Financial Services":
    "Bancos, aseguradoras, empresas de inversión, medios de pago y otros servicios relacionados con las finanzas.",

  Industrials:
    "Empresas dedicadas a la fabricación, maquinaria, construcción, transporte y servicios industriales.",

  Healthcare:
    "Empresas de productos farmacéuticos, biotecnología, equipamiento y servicios de salud.",

  "Communication Services":
    "Empresas de telecomunicaciones, medios, entretenimiento, publicidad y plataformas de comunicación.",

  "Consumer Cyclical":
    "Empresas cuyos productos y servicios suelen tener mayor demanda cuando la economía y el consumo crecen.",

  Energy:
    "Empresas relacionadas con petróleo, gas, combustibles, generación y producción de energía.",

  "Consumer Defensive":
    "Empresas de productos y servicios esenciales, como alimentos, bebidas, higiene y productos del hogar.",

  "Basic Materials":
    "Empresas que producen materias primas como metales, minerales, químicos, papel y materiales de construcción.",

  "Real Estate":
    "Empresas vinculadas a propiedades, desarrollo inmobiliario, alquileres y gestión de bienes raíces.",

  Utilities:
    "Empresas que brindan servicios esenciales como electricidad, gas, agua y distribución de energía.",

  // Variantes / aliases de Yahoo Finance

  Financials:
    "Bancos, aseguradoras, empresas de inversión, medios de pago y otros servicios relacionados con las finanzas.",

  Finance:
    "Bancos, aseguradoras, empresas de inversión, medios de pago y otros servicios relacionados con las finanzas.",

  "Consumer Discretionary":
    "Empresas cuyos productos y servicios suelen tener mayor demanda cuando la economía y el consumo crecen.",

  "Consumer Staples":
    "Empresas de productos y servicios esenciales, como alimentos, bebidas, higiene y productos del hogar.",

  "Health Care":
    "Empresas de productos farmacéuticos, biotecnología, equipamiento y servicios de salud.",

  "Health Care Services":
    "Empresas de productos farmacéuticos, biotecnología, equipamiento y servicios de salud.",

  Communications:
    "Empresas de telecomunicaciones, medios, entretenimiento, publicidad y plataformas de comunicación.",

  Materials:
    "Empresas que producen materias primas como metales, minerales, químicos, papel y materiales de construcción.",

  "Real Estate Investment Trusts":
    "Empresas vinculadas a propiedades, desarrollo inmobiliario, alquileres y gestión de bienes raíces.",

  // Categorías propias de la aplicación

  "Renta fija":
    "Instrumentos que representan deuda y generan pagos de intereses y/o amortización según condiciones preestablecidas.",

  "Fondos comunes":
    "Vehículos de inversión que agrupan el capital de varios inversores para invertir en una cartera diversificada.",

  Cripto:
    "Activos digitales basados principalmente en tecnología blockchain, como Bitcoin y otras criptomonedas.",

  ETF:
    "Fondos que cotizan en bolsa y permiten invertir en una cartera de activos, índice, sector o estrategia.",

  "Sin clasificar":
    "Instrumentos para los que todavía no se ha identificado o asignado un sector.",

  // Español (nombres traducidos en el dashboard)

  Tecnología:
    "Empresas que desarrollan software, hardware, semiconductores y otras soluciones tecnológicas.",

  "Servicios financieros":
    "Bancos, aseguradoras, empresas de inversión, medios de pago y otros servicios relacionados con las finanzas.",

  Industria:
    "Empresas dedicadas a la fabricación, maquinaria, construcción, transporte y servicios industriales.",

  Salud:
    "Empresas de productos farmacéuticos, biotecnología, equipamiento y servicios de salud.",

  Comunicación:
    "Empresas de telecomunicaciones, medios, entretenimiento, publicidad y plataformas de comunicación.",

  "Consumo cíclico":
    "Empresas cuyos productos y servicios suelen tener mayor demanda cuando la economía y el consumo crecen.",

  Energía:
    "Empresas relacionadas con petróleo, gas, combustibles, generación y producción de energía.",

  "Consumo defensivo":
    "Empresas de productos y servicios esenciales, como alimentos, bebidas, higiene y productos del hogar.",

  "Materiales básicos":
    "Empresas que producen materias primas como metales, minerales, químicos, papel y materiales de construcción.",

  Inmobiliario:
    "Empresas vinculadas a propiedades, desarrollo inmobiliario, alquileres y gestión de bienes raíces.",

  "Servicios públicos":
    "Empresas que brindan servicios esenciales como electricidad, gas, agua y distribución de energía.",
};

