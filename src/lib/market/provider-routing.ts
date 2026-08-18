import type { InstrumentType } from "@/lib/generated/prisma";
import type {
  MonitoringAdjustmentPolicy,
  MonitoringCurrency,
  MonitoringSeriesKind,
} from "@/lib/monitoreo/types";

export const DATA912_EOD_SOURCE = "data912-eod";
export const DATA912_LIVE_SOURCE = "data912-live";
export const YAHOO_EOD_SOURCE = "yahoo-eod";
export const YAHOO_UNDERLYING_EOD_SOURCE = "yahoo-underlying-eod";
export const FMP_EOD_SOURCE = "fmp-eod";

export const MONITORING_SOURCES = [
  DATA912_EOD_SOURCE,
  DATA912_LIVE_SOURCE,
  YAHOO_EOD_SOURCE,
  YAHOO_UNDERLYING_EOD_SOURCE,
  FMP_EOD_SOURCE,
] as const;

export type MonitoringSource = (typeof MONITORING_SOURCES)[number];

export type ProviderResolution = {
  provider: "data912" | "yahoo" | "fmp" | "derived";
  source: string;
  externalSymbol: string;
  currency: MonitoringCurrency;
  adjustmentPolicy: MonitoringAdjustmentPolicy;
};

export type ResolvableInstrument = {
  id: string;
  ticker: string;
  type: InstrumentType;
  currencyCode: string;
  underlyingAsset?: { ticker: string } | null;
};

export function resolveMonitoringRouting(
  instrument: ResolvableInstrument,
  seriesKind: MonitoringSeriesKind,
  preferYahoo = false
): ProviderResolution {
  const isCedear = instrument.type === "CEDEAR";
  const isStockAr = instrument.type === "STOCK_AR";
  const hasFmpKey = Boolean(process.env.FINANCIALMODELINGPREP_APIKEY);

  // CEDEAR Underlying mode (USD)
  if (isCedear && seriesKind === "cedear-underlying") {
    const underlyingTicker = instrument.underlyingAsset?.ticker || instrument.ticker;
    if (hasFmpKey && !preferYahoo) {
      return {
        provider: "fmp",
        source: FMP_EOD_SOURCE,
        externalSymbol: underlyingTicker,
        currency: "USD",
        adjustmentPolicy: "raw",
      };
    }
    return {
      provider: "yahoo",
      source: YAHOO_UNDERLYING_EOD_SOURCE,
      externalSymbol: underlyingTicker,
      currency: "USD",
      adjustmentPolicy: "raw",
    };
  }

  // CEDEAR Theoretical mode
  if (isCedear && seriesKind === "cedear-theoretical") {
    return {
      provider: "derived",
      source: "cedear-theoretical",
      externalSymbol: instrument.ticker,
      currency: "ARS",
      adjustmentPolicy: "raw",
    };
  }

  // Local Argentinian assets (STOCK_AR or CEDEAR in native ARS mode)
  if (isStockAr || isCedear) {
    if (preferYahoo) {
      return {
        provider: "yahoo",
        source: YAHOO_EOD_SOURCE,
        externalSymbol: `${instrument.ticker}.BA`,
        currency: "ARS",
        adjustmentPolicy: "raw",
      };
    }
    return {
      provider: "data912",
      source: DATA912_EOD_SOURCE,
      externalSymbol: instrument.ticker,
      currency: "ARS",
      adjustmentPolicy: "raw",
    };
  }

  // Foreign / USD stocks
  if (instrument.type === "STOCK_US" || instrument.type === "ETF") {
    if (hasFmpKey && !preferYahoo) {
      return {
        provider: "fmp",
        source: FMP_EOD_SOURCE,
        externalSymbol: instrument.ticker,
        currency: "USD",
        adjustmentPolicy: "raw",
      };
    }
    return {
      provider: "yahoo",
      source: YAHOO_EOD_SOURCE,
      externalSymbol: instrument.ticker,
      currency: "USD",
      adjustmentPolicy: "raw",
    };
  }

  // Fallback / ON / Other
  return {
    provider: "data912",
    source: DATA912_EOD_SOURCE,
    externalSymbol: instrument.ticker,
    currency: "ARS",
    adjustmentPolicy: "raw",
  };
}
