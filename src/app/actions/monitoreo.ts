"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { fetchMonitoringSeries } from "@/lib/monitoreo/load-series";
import { prisma } from "@/lib/prisma";
import {
  loadCachedMonitoringBars,
  loadExternalMonitoringHistory,
  persistMissingRecentBars,
} from "@/lib/monitoreo/data";
import {
  buildMonitoringSeries,
  filterBarsByRange,
  mergeHistoryBars,
} from "@/lib/monitoreo/series";
import type { TradeMarkerInput } from "@/lib/monitoreo/trade-markers";
import type {
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

const getTradeMarkerDataInputSchema = z.object({
  instrumentId: z.string().min(1),
});

export type GetTradeMarkerDataInput = z.infer<typeof getTradeMarkerDataInputSchema>;

export async function getMonitoringSeriesAction(
  input: GetMonitoringSeriesInput
): Promise<MonitoringSeries | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const parsed = getSeriesInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Parámetros de consulta no válidos" };
  }

  const series = await fetchMonitoringSeries(parsed.data);
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

/**
 * Trades (BUY/SELL only) and corporate event dates for one instrument, scoped to the
 * current user's default portfolio. Feeds `buildTradeMarkers` (src/lib/monitoreo/trade-markers.ts)
 * on the client — Decimal/Date fields are serialized to plain number/string here since that
 * module takes no Prisma types.
 */
export async function getInstrumentTradeMarkersAction(
  input: GetTradeMarkerDataInput
): Promise<
  { trades: TradeMarkerInput[]; corporateEventDates: string[] } | { error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const parsed = getTradeMarkerDataInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Parámetros de consulta no válidos" };
  }

  const portfolio = await prisma.portfolio.findFirst({
    where: { userId: user.id, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  if (!portfolio) {
    return { trades: [], corporateEventDates: [] };
  }

  const [tradeRows, eventRows] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        portfolioId: portfolio.id,
        instrumentId: parsed.data.instrumentId,
        type: { in: ["BUY", "SELL"] },
      },
      orderBy: { tradeDate: "asc" },
      select: {
        id: true,
        tradeDate: true,
        type: true,
        quantity: true,
        price: true,
        currencyCode: true,
        grossAmount: true,
        fees: true,
      },
    }),
    // Corporate events are global per instrument, but we only surface them for instruments
    // the user actually holds/held — same ownership check as `listCorporateEvents` (events.ts).
    prisma.corporateEvent.findMany({
      where: {
        instrumentId: parsed.data.instrumentId,
        instrument: { transactions: { some: { portfolio: { userId: user.id } } } },
      },
      select: { effectiveDate: true },
    }),
  ]);

  const trades: TradeMarkerInput[] = tradeRows.map((t) => ({
    id: t.id,
    tradeDate: t.tradeDate.toISOString().slice(0, 10),
    type: t.type as "BUY" | "SELL",
    quantity: Number(t.quantity.toString()),
    price: Number(t.price.toString()),
    currencyCode: t.currencyCode,
    grossAmount: Number(t.grossAmount.toString()),
    fees: Number(t.fees.toString()),
  }));

  const corporateEventDates = eventRows.map((e) => e.effectiveDate.toISOString().slice(0, 10));

  return { trades, corporateEventDates };
}
