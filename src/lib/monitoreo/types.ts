import type { InstrumentType } from "@/lib/generated/prisma";

export type MonitoringCurrency = "ARS" | "USD";
export type MonitoringRange = "1M" | "3M" | "6M" | "1Y" | "ALL";
export type MonitoringSeriesKind = "native" | "cedear-underlying" | "cedear-theoretical";
export type MonitoringChartType = "line" | "candles";
export type MonitoringAdjustmentPolicy = "raw" | "split-adjusted";
export type MonitoringCacheCoverage = "none" | "partial" | "two-years";
export type MonitoringHistoryStatus =
  | "cached"
  | "live-fallback"
  | "not-requested"
  | "loaded"
  | "unavailable";

export type MonitoringInstrument = {
  id: string;
  ticker: string;
  name: string;
  type: InstrumentType;
  nativeCurrency: string;
  isCedear: boolean;
  underlyingTicker: string | null;
  inPortfolio: boolean;
  supported: boolean;
  availableSources: string[];
  unavailableReason: string | null;
  cacheCoverage: MonitoringCacheCoverage;
  oldestCachedDate: string | null;
  latestCachedDate: string | null;
};

export type MonitoringBar = {
  /** YYYY-MM-DD representing trading day (UTC) */
  time: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

export type MonitoringSeries = {
  instrumentId: string;
  ticker: string;
  label: string;
  currency: MonitoringCurrency;
  kind: MonitoringSeriesKind;
  chartType: MonitoringChartType;
  provider: "data912" | "yahoo" | "fmp" | "derived";
  source: string;
  adjustmentPolicy: MonitoringAdjustmentPolicy;
  historyStatus: MonitoringHistoryStatus;
  bars: MonitoringBar[];
  firstDate: string | null;
  lastDate: string | null;
  lastValue: number | null;
  changePct: number | null;
  dataQuality: {
    missingDays: number;
    stalePoints: number;
    missingCclDays: number;
    missingOhlcBars: number;
    warning: string | null;
  };
};

export type MonitoringBootstrapData = {
  instruments: MonitoringInstrument[];
  selectedInstrumentId: string | null;
  initialSeries: MonitoringSeries | null;
};
