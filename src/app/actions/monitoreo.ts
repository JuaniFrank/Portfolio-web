"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  DATA912_EOD_SOURCE,
  FMP_EOD_SOURCE,
  resolveMonitoringRouting,
  YAHOO_EOD_SOURCE,
  YAHOO_UNDERLYING_EOD_SOURCE,
} from "@/lib/market/provider-routing";
import {
  listMonitoringInstruments,
  loadCachedMonitoringBars,
  loadExternalLatestQuote,
  loadExternalMonitoringHistory,
  persistMissingRecentBars,
} from "@/lib/monitoreo/data";
import {
  buildMonitoringSeries,
  filterBarsByRange,
  mergeHistoryBars,
} from "@/lib/monitoreo/series";
import type {
  MonitoringBootstrapData,
  MonitoringHistoryStatus,
  MonitoringSeries,
} from "@/lib/monitoreo/types";

const getSeriesInputSchema = z.object({
  instrumentId: z.string().min(1),
  currency: z.enum(["ARS", "USD"]).default("ARS"),
  range: z.enum(["1M", "3M", "6M", "1Y", "ALL"]).default("ALL"),
  chartType: z.enum(["line", "candles"]).default("line"),
  kind: z.enum(["native", "cedear-underlying", "cedear-theoretical"]).default("native"),
});

export type GetMonitoringSeriesInput = z.infer<typeof getSeriesInputSchema>;

export async function getMonitoringBootstrapAction(): Promise<
  MonitoringBootstrapData | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const instruments = await listMonitoringInstruments(user.id);
  if (instruments.length === 0) {
    return {
      instruments: [],
      selectedInstrumentId: null,
      initialSeries: null,
    };
  }

  // Pick first instrument in portfolio, or first available instrument
  const recommended = instruments.find((i) => i.inPortfolio) || instruments[0]!;
  const defaultKind = recommended.isCedear ? "cedear-underlying" : "native";
  const defaultCurrency = recommended.isCedear ? "USD" : "ARS";

  const initialSeries = await fetchSeriesInternal({
    instrumentId: recommended.id,
    currency: defaultCurrency,
    range: "ALL",
    chartType: "line",
    kind: defaultKind,
  });

  return {
    instruments,
    selectedInstrumentId: recommended.id,
    initialSeries,
  };
}

export async function getMonitoringSeriesAction(
  input: GetMonitoringSeriesInput
): Promise<MonitoringSeries | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const parsed = getSeriesInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Parámetros de consulta no válidos" };
  }

  const series = await fetchSeriesInternal(parsed.data);
  if (!series) {
    return { error: "Instrumento no encontrado o no disponible" };
  }

  return series;
}

export async function loadMonitoringHistoryAction(
  input: GetMonitoringSeriesInput
): Promise<MonitoringSeries | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const parsed = getSeriesInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Parámetros de consulta no válidos" };
  }

  const instrument = await prisma.instrument.findUnique({
    where: { id: parsed.data.instrumentId },
    include: { underlyingAsset: { select: { ticker: true } } },
  });

  if (!instrument) {
    return { error: "Instrumento no encontrado" };
  }

  // 1. Fetch full external history
  const external = await loadExternalMonitoringHistory(instrument, parsed.data.kind);

  // 2. Fetch existing cached bars
  const cachedBars = await loadCachedMonitoringBars(instrument.id, external.source);

  // 3. Merge in memory
  const allBars = mergeHistoryBars(cachedBars, external.bars);

  // 4. Persist missing bars for last 2 years
  if (external.bars.length > 0) {
    try {
      await persistMissingRecentBars(instrument.id, external.source, external.bars);
    } catch (err) {
      console.error("Error persisting missing history bars:", err);
    }
  }

  const filteredBars = filterBarsByRange(allBars, parsed.data.range);
  const historyStatus: MonitoringHistoryStatus =
    allBars.length > 0 ? "loaded" : "unavailable";

  return buildMonitoringSeries({
    instrumentId: instrument.id,
    ticker: instrument.ticker,
    label: instrument.name,
    currency: parsed.data.currency,
    kind: parsed.data.kind,
    chartType: parsed.data.chartType,
    provider: external.provider,
    source: external.source,
    historyStatus,
    bars: filteredBars,
  });
}

async function fetchSeriesInternal(
  input: GetMonitoringSeriesInput
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
