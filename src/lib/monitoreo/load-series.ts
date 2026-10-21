import { prisma } from "@/lib/prisma";
import {
  DATA912_EOD_SOURCE,
  FMP_EOD_SOURCE,
  resolveMonitoringRouting,
  YAHOO_EOD_SOURCE,
  YAHOO_UNDERLYING_EOD_SOURCE,
} from "@/lib/market/provider-routing";
import { loadCachedMonitoringBars, loadExternalLatestQuote } from "@/lib/monitoreo/data";
import { buildMonitoringSeries, filterBarsByRange } from "@/lib/monitoreo/series";
import type {
  MonitoringChartType,
  MonitoringCurrency,
  MonitoringHistoryStatus,
  MonitoringRange,
  MonitoringSeries,
  UiMonitoringSeriesKind,
} from "@/lib/monitoreo/types";

export type MonitoringSeriesInput = {
  instrumentId: string;
  currency: MonitoringCurrency;
  range: MonitoringRange;
  chartType: MonitoringChartType;
  kind: UiMonitoringSeriesKind;
};

export async function fetchMonitoringSeries(
  input: MonitoringSeriesInput
): Promise<MonitoringSeries | null> {
  const instrument = await prisma.instrument.findUnique({
    where: { id: input.instrumentId },
    include: { underlyingAsset: { select: { ticker: true } } },
  });

  if (!instrument) return null;

  const routing = resolveMonitoringRouting(instrument, input.kind);
  let bars = await loadCachedMonitoringBars(instrument.id, routing.source);
  let effectiveSource = routing.source;
  let effectiveProvider = routing.provider;
  let historyStatus: MonitoringHistoryStatus = "cached";

  // If no cached bars for the primary source, check known alternate cached sources for the same currency mode
  if (bars.length === 0) {
    if (input.currency === "ARS") {
      const altSources = [DATA912_EOD_SOURCE, YAHOO_EOD_SOURCE].filter((s) => s !== routing.source);
      for (const alt of altSources) {
        const altBars = await loadCachedMonitoringBars(instrument.id, alt);
        if (altBars.length > 0) {
          bars = altBars;
          effectiveSource = alt;
          effectiveProvider = alt.startsWith("data912") ? "data912" : "yahoo";
          break;
        }
      }
    } else if (input.currency === "USD") {
      const altSources = [FMP_EOD_SOURCE, YAHOO_UNDERLYING_EOD_SOURCE].filter((s) => s !== routing.source);
      for (const alt of altSources) {
        const altBars = await loadCachedMonitoringBars(instrument.id, alt);
        if (altBars.length > 0) {
          bars = altBars;
          effectiveSource = alt;
          effectiveProvider = alt.startsWith("fmp") ? "fmp" : "yahoo";
          break;
        }
      }
    }
  }

  // If still no cached bars, try live quote fallback
  if (bars.length === 0) {
    const liveBar = await loadExternalLatestQuote(instrument);
    if (liveBar) {
      bars = [liveBar];
      historyStatus = "live-fallback";
    } else {
      historyStatus = "not-requested";
    }
  }

  const filteredBars = filterBarsByRange(bars, input.range);

  return buildMonitoringSeries({
    instrumentId: instrument.id,
    ticker: instrument.ticker,
    label: instrument.name,
    currency: input.currency,
    kind: input.kind,
    chartType: input.chartType,
    provider: effectiveProvider,
    source: effectiveSource,
    historyStatus,
    bars: filteredBars,
  });
}
