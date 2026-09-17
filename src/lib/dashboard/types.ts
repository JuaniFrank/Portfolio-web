import type { InstrumentType } from "@/lib/generated/prisma";
import type { PortfolioEvolution } from "./evolution";

export type DashboardCurrency = "ARS" | "USD";

export type MarketSegment = "CEDEAR" | "Locales" | "Externos" | "Cripto" | "Otros";

export type DashboardKpis = {
  totalInvestedArs: string;
  /** Costo en dólares al CCL del día de cada compra, no al de hoy. */
  totalInvestedUsd: string;
  currentValueArs: string;
  currentValueUsd: string;
  unrealizedPnlArs: string;
  unrealizedPnlUsd: string;
  unrealizedPnlPercent: string;
  /**
   * Rendimiento medido en dólares. Difiere del de pesos cuando el CCL se movió: es la
   * diferencia entre haberle ganado al mercado y haberle ganado al dólar.
   */
  unrealizedPnlPercentUsd: string;
  /** Alguna posición no tenía CCL histórico y su costo en dólares se estimó al de hoy. */
  usdBasisIsApproximate: boolean;
  cashArs: string;
  cashUsd: string;
  totalInstruments: number;
};

export type DashboardHolding = {
  instrumentId: string;
  ticker: string;
  instrumentName: string;
  instrumentType: InstrumentType;
  marketSegment: MarketSegment;
  sector: string;
  quantity: string;
  marketValueArs: string;
  marketValueUsd: string;
  pnlArs: string;
  pnlPercent: string;
  pnlUsd: string;
  /** Rendimiento en dólares: valor de hoy al CCL de hoy contra costo al CCL de compra. */
  pnlPercentUsd: string;
  /** Porcentaje del valor total del portfolio (0-100). */
  weightPercent: string;
};

export type AllocationSliceDetail = {
  key: string;
  label: string;
  valueArs: string;
  valueUsd: string;
  percent: string;
};

export type AllocationSlice = {
  key: string;
  label: string;
  valueArs: string;
  valueUsd: string;
  percent: string;
  /** Desglose al hacer hover (p. ej. tickers de ON agrupados). */
  details?: AllocationSliceDetail[];
};

export type SectorBar = {
  sector: string;
  valueArs: string;
  valueUsd: string;
  percent: string;
};

export type ConcentrationStats = {
  /** Suma del peso de las 5 posiciones más grandes. */
  top5Percent: string;
  /** Ticker con mayor peso. */
  topHoldingTicker: string | null;
  topHoldingPercent: string;
  /** Herfindahl-Hirschman Index (0..10000). */
  hhi: string;
  /** Clasificación cualitativa */
  level: "baja" | "moderada" | "alta" | "muy_alta";
  /** Posiciones con peso individual > 25%. */
  oversizedPositions: Array<{ ticker: string; percent: string }>;
};

export type TopMover = {
  ticker: string;
  instrumentName: string;
  pnlArs: string;
  pnlUsd: string;
  pnlPercent: string;
  pnlPercentUsd: string;
};

export type DashboardData = {
  hasData: boolean;
  portfolioName: string;
  kpis: DashboardKpis;
  cclRate: string | null;
  holdings: DashboardHolding[];
  allocationByTicker: AllocationSlice[];
  allocationByMarket: AllocationSlice[];
  allocationBySector: SectorBar[];
  topGainers: TopMover[];
  topLosers: TopMover[];
  /**
   * Ranking medido en dólares. Es una lista propia y no la misma reordenada: el orden
   * —y el signo— cambian cuando las compras se hicieron a distinto tipo de cambio.
   */
  topGainersUsd: TopMover[];
  topLosersUsd: TopMover[];
  concentration: ConcentrationStats;
  /** Serie histórica reconstruida. Ver `@/lib/dashboard/evolution`. */
  evolution: PortfolioEvolution;
};
