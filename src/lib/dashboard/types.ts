import type { InstrumentType } from "@/lib/generated/prisma";

export type DashboardCurrency = "ARS" | "USD";

export type MarketSegment = "CEDEAR" | "Locales" | "Externos" | "Cripto" | "Otros";

export type DashboardKpis = {
  totalInvestedArs: string;
  totalInvestedUsd: string;
  currentValueArs: string;
  currentValueUsd: string;
  unrealizedPnlArs: string;
  unrealizedPnlUsd: string;
  unrealizedPnlPercent: string;
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
  /** Porcentaje del valor total del portfolio (0-100). */
  weightPercent: string;
};

export type AllocationSlice = {
  key: string;
  label: string;
  valueArs: string;
  valueUsd: string;
  percent: string;
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
  concentration: ConcentrationStats;
};
