import { prisma } from "@/lib/prisma";
import {
  loadCachedMonitoringBars,
  loadExternalMonitoringHistory,
  persistMissingRecentBars,
} from "@/lib/monitoreo/data";
import type { ParsedSeriesInput } from "@/lib/monitoreo/api-schemas";
import {
  buildMonitoringSeries,
  filterBarsByRange,
  mergeHistoryBars,
} from "@/lib/monitoreo/series";
import type { MonitoringHistoryStatus, MonitoringSeries } from "@/lib/monitoreo/types";

/**
 * Fetch an instrument's full external history, merge it with the cached bars and persist the
 * missing recent ones. Returns null when the instrument does not exist. Server-only (Prisma).
 */
export async function loadMonitoringHistory(
  input: ParsedSeriesInput
): Promise<MonitoringSeries | null> {
  const instrument = await prisma.instrument.findUnique({
    where: { id: input.instrumentId },
    include: { underlyingAsset: { select: { ticker: true } } },
  });
  if (!instrument) return null;

  // 1. Fetch full external history
  const external = await loadExternalMonitoringHistory(instrument, input.kind);

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

  const historyStatus: MonitoringHistoryStatus = allBars.length > 0 ? "loaded" : "unavailable";

  return buildMonitoringSeries({
    instrumentId: instrument.id,
    ticker: instrument.ticker,
    label: instrument.name,
    currency: input.currency,
    kind: input.kind,
    chartType: input.chartType,
    provider: external.provider,
    source: external.source,
    historyStatus,
    bars: filterBarsByRange(allBars, input.range),
  });
}
