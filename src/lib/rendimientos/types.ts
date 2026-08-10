import type { InstrumentType } from "@/lib/generated/prisma";

export type ViewCurrency = "ARS" | "USD";

// ============================================================
// ALCANCE DEL CÁLCULO
// ============================================================

/**
 * Tipos de instrumento que entran en el cálculo de rendimientos.
 *
 * Dos criterios, y hay que cumplir los dos:
 *
 * 1. **¿Existe serie de precios histórica?** Sin histórico no se puede valuar un mes
 *    pasado, y valuar en cero es peor que excluir.
 * 2. **¿Cotiza en ARS?** `buildHoldings` suma `marketValueArs` y `costBasisArs` como
 *    pesos. Un instrumento cotizado en dólares mezclaría monedas dentro del mismo total
 *    sin que nada avise, así que `STOCK_US` y `ETF` quedan afuera hasta que la valuación
 *    sea multi-moneda. CEDEAR y STOCK_AR cotizan en BYMA en pesos y son los únicos tipos
 *    que la app opera hoy junto con ON.
 */
export const PERFORMANCE_INSTRUMENT_TYPES: InstrumentType[] = ["CEDEAR", "STOCK_AR"];

/**
 * Por qué queda afuera cada tipo excluido. Se muestra en la UI: el usuario tiene
 * derecho a saber qué parte de su cartera no está en el número que está mirando.
 */
export const EXCLUSION_REASONS: Partial<Record<InstrumentType, string>> = {
  ON: "Sin histórico de precios disponible (data912 solo publica cotizaciones del día).",
  BOND_AR: "Sin histórico de precios disponible.",
  LETRA: "Sin histórico de precios disponible.",
  FCI: "Sin histórico de cuotapartes disponible.",
  STOCK_US: "Cotiza en dólares y la valuación todavía es en pesos.",
  ETF: "Cotiza en dólares y la valuación todavía es en pesos.",
  CRYPTO: "Todavía no integrado al motor de rendimientos.",
  STABLECOIN: "Todavía no integrado al motor de rendimientos.",
  OPTION: "Fuera de alcance.",
  FUTURE: "Fuera de alcance.",
};

/** Instrumento con tenencia que quedó fuera del cálculo, para explicarlo en la UI. */
export type ExcludedHolding = {
  ticker: string;
  instrumentName: string;
  instrumentType: InstrumentType;
  reason: string;
};

// ============================================================
// SERIE MENSUAL
// ============================================================

/** Detalle de una posición al cierre del mes (fila expandible de la tabla). */
export type PositionDetail = {
  instrumentId: string;
  ticker: string;
  instrumentName: string;
  instrumentType: InstrumentType;
  quantity: number;
  priceArs: number;
  valueArs: number;
  valueUsd: number;
  costBasisArs: number;
  unrealizedPnlArs: number;
  unrealizedReturnPct: number | null;
  /**
   * `true` cuando el precio no es del cierre de ese mes sino un arrastre del
   * último conocido. La UI lo marca: un número arrastrado no es un número medido.
   */
  priceIsStale: boolean;
};

/** Calidad del dato de un mes. */
export type MonthCoverage =
  /** Todos los instrumentos con tenencia tenían precio del mes. */
  | "full"
  /** Al menos un precio vino por arrastre (forward-fill). */
  | "partial"
  /** No había tenencia ni efectivo: mes sin cartera. */
  | "empty";

export type MonthlyPerformanceRow = {
  /** Clave del mes en formato `"YYYY-MM"`. */
  month: string;
  /** Fecha de valuación realmente usada: último día con precio ≤ fin de mes. */
  valuationDate: string;
  /** CCL del cierre del mes. `null` si no hay cotización para ese rango. */
  cclMonthEnd: number | null;

  /**
   * Valor **invertido**: posiciones a precio de mercado + renta acumulada.
   *
   * No incluye el efectivo de la cuenta. El perímetro es el capital puesto en activos,
   * no el saldo del broker — ver `cashflows.ts`.
   */
  valueArs: number;
  valueUsd: number;

  /** Capital neto invertido en el mes: compras − ventas. Ver `cashflows.ts`. */
  netInvestedArs: number;
  netInvestedUsd: number;
  cumulativeInvestedArs: number;
  cumulativeInvestedUsd: number;

  /** Renta cobrada en el mes (dividendos, cupones, intereses) neta de costos. */
  incomeArs: number;
  incomeUsd: number;

  /** Ganancia del mes en moneda: ΔValor − capital neto invertido. */
  gainArs: number;
  gainUsd: number;
  cumulativeGainArs: number;
  cumulativeGainUsd: number;

  /** Rendimiento del mes por Modified Dietz. `null` si no hay base comparable. */
  monthlyReturnArs: number | null;
  monthlyReturnUsd: number | null;
  /** Rendimiento acumulado por encadenamiento TWR desde el inicio del período. */
  cumulativeReturnArs: number | null;
  cumulativeReturnUsd: number | null;

  /** `marketValue / costBasis − 1` sobre posiciones abiertas al cierre del mes. */
  unrealizedReturnPct: number | null;

  /** Caída desde el pico de valor alcanzado hasta este mes, en %. Siempre ≤ 0. */
  drawdownArs: number;
  drawdownUsd: number;

  positions: PositionDetail[];
  coverage: MonthCoverage;
  /** Tickers cuyo precio vino por arrastre en este mes. */
  staleTickers: string[];
};

// ============================================================
// BENCHMARKS
// ============================================================

export type BenchmarkKey = "IPC_AR" | "MERVAL" | "SP500";

export type BenchmarkPoint = {
  month: string;
  /** Variación porcentual del mes. */
  monthlyPercent: number | null;
  /** Variación acumulada desde el inicio del período. */
  cumulativePercent: number | null;
};

export type BenchmarkSeries = {
  key: BenchmarkKey;
  label: string;
  /** Contra qué serie del portfolio es comparable. Nunca mezclar monedas. */
  currency: ViewCurrency;
  color: string;
  points: BenchmarkPoint[];
  /** `false` cuando no hay ni un punto en la DB: la UI esconde el toggle. */
  available: boolean;
  /**
   * Último mes con dato publicado. Sirve para avisar del lag del INDEC en vez de
   * dejar que el usuario lea un hueco como un cero.
   */
  lastAvailableMonth: string | null;
};

// ============================================================
// RESUMEN Y REPORTE
// ============================================================

export type ExtremeMonth = {
  month: string;
  returnPercent: number;
};

export type PerformanceSummary = {
  currentValueArs: number;
  currentValueUsd: number;
  cumulativeReturnArs: number | null;
  cumulativeReturnUsd: number | null;
  cumulativeGainArs: number;
  cumulativeGainUsd: number;
  /** Capital neto invertido en el período: compras − ventas. */
  netInvestedArs: number;
  netInvestedUsd: number;
  /** Rendimiento anualizado a partir del acumulado y los meses transcurridos. */
  annualizedReturnArs: number | null;
  annualizedReturnUsd: number | null;
  maxDrawdownArs: number;
  maxDrawdownUsd: number;
  bestMonthArs: ExtremeMonth | null;
  worstMonthArs: ExtremeMonth | null;
  monthsTracked: number;
};

export type DataQuality = {
  /** Meses en los que algún precio vino por arrastre. */
  partialMonths: string[];
  /** Meses sin cotización de CCL: la serie en USD de esos meses no es confiable. */
  missingCclMonths: string[];
  /** Fecha del último precio EOD que hay en la base, o `null` si nunca se backfilleó. */
  lastPriceSyncDate: string | null;
  /** Primer mes efectivamente reportado, en ISO. */
  seriesFloor: string | null;
};

export type PerformanceReport = {
  portfolioName: string;
  /** Ordenado ascendente por mes. */
  months: MonthlyPerformanceRow[];
  benchmarks: BenchmarkSeries[];
  summary: PerformanceSummary;
  excludedHoldings: ExcludedHolding[];
  dataQuality: DataQuality;
};
