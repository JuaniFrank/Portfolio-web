import { prisma } from "@/lib/prisma";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import { fetchYahooHistory } from "@/lib/market/yahoo";
import { isSplitAdjustmentEnabled } from "@/lib/monitoreo/split-adjustment-config";
import {
  adjustmentModeForSource,
  resolveSeriesAdjustment,
  type SeriesAdjustment,
  type SplitInput,
} from "@/lib/monitoreo/split-adjustment";
import type { MonitoringBar } from "@/lib/monitoreo/types";

const SPLITS_REVALIDATE_SECONDS = 6 * 3600;
const DAY_MS = 24 * 3600 * 1000;

/** The instrument's CorporateEvents in the shape `adjustBarsForEvents` takes (ascending). */
async function loadInstrumentEvents(instrumentId: string): Promise<CorporateEventForBuilder[]> {
  const rows = await prisma.corporateEvent.findMany({
    where: { instrumentId },
    orderBy: { effectiveDate: "asc" },
    select: { eventType: true, effectiveDate: true, numerator: true, denominator: true },
  });
  return rows.map((e) => ({
    instrumentId,
    eventType: e.eventType,
    effectiveDate: e.effectiveDate.toISOString().slice(0, 10),
    numerator: e.numerator.toString(),
    denominator: e.denominator.toString(),
  }));
}

/** Real splits of the underlying since `firstBarDay`; null when Yahoo can't be reached. */
async function loadUnderlyingSplits(symbol: string, firstBarDay: string): Promise<SplitInput[] | null> {
  try {
    // Whole-day bounds keep the Yahoo URL (the fetch cache key) stable within a day.
    const from = new Date(`${firstBarDay}T00:00:00.000Z`);
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    const res = await fetchYahooHistory(
      symbol,
      { from, to: new Date(today.getTime() + DAY_MS) },
      { revalidateSeconds: SPLITS_REVALIDATE_SECONDS }
    );
    return res.splits.map((s) => ({
      date: s.date.toISOString().slice(0, 10),
      numerator: s.numerator,
      denominator: s.denominator,
    }));
  } catch {
    return null;
  }
}

/**
 * Read-time split adjustment of an already merged series (see `split-adjustment.ts`). Works on
 * a copy: what was persisted to PriceCache is never touched. Server-only (Prisma, Yahoo).
 * `externalSymbol` is the symbol whose splits apply (see `underlyingSplitSymbol`).
 */
export async function adjustSeriesForRead(input: {
  instrumentId: string;
  externalSymbol: string;
  source: string;
  bars: MonitoringBar[];
  /** The user's "Ajustado" toggle */
  adjusted: boolean;
}): Promise<SeriesAdjustment> {
  const enabled = isSplitAdjustmentEnabled();
  const mode = adjustmentModeForSource(input.source);
  const wantsAdjust = enabled && input.adjusted && input.bars.length > 0;

  const instrumentEvents =
    wantsAdjust && mode === "instrument-events" ? await loadInstrumentEvents(input.instrumentId) : [];
  const underlyingSplits =
    wantsAdjust && mode === "underlying-splits"
      ? await loadUnderlyingSplits(input.externalSymbol, input.bars[0]!.time)
      : null;

  return resolveSeriesAdjustment({
    source: input.source,
    bars: input.bars,
    enabled,
    adjusted: input.adjusted,
    instrumentEvents,
    underlyingSplits,
  });
}
