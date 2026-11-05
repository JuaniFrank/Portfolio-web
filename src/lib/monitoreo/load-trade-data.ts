import { prisma } from "@/lib/prisma";
import { DATA912_EOD_SOURCE, YAHOO_EOD_SOURCE } from "@/lib/market/provider-routing";
import { selectPointsInWindows, tradeQueryBounds } from "@/lib/monitoreo/ccl-windows";
import { toAdjustmentEvents } from "@/lib/monitoreo/split-adjustment";
import { EMPTY_TRADE_MARKER_DATA, type TradeMarkerData } from "@/lib/monitoreo/trade-marker-data";
import type { TradeMarkerInput } from "@/lib/monitoreo/trade-markers";

const PROJECTION_WINDOW_DAYS = 7;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const startOfDayUtc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * Trades and projection inputs of one instrument for the user's default portfolio.
 * Server-only (Prisma); the caller is responsible for authenticating `userId`.
 */
export async function loadInstrumentTradeData(
  userId: string,
  instrumentId: string
): Promise<TradeMarkerData> {
  const portfolio = await prisma.portfolio.findFirst({
    where: { userId, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!portfolio) return EMPTY_TRADE_MARKER_DATA;

  const [tradeRows, eventRows] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        portfolioId: portfolio.id,
        instrumentId,
        type: { in: ["BUY", "SELL"] },
      },
      orderBy: [{ tradeDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
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
        instrumentId,
        instrument: { transactions: { some: { portfolio: { userId } } } },
      },
      select: { effectiveDate: true, eventType: true, numerator: true, denominator: true },
    }),
  ]);

  const trades: TradeMarkerInput[] = tradeRows.map((t) => ({
    id: t.id,
    tradeDate: isoDay(t.tradeDate),
    type: t.type as "BUY" | "SELL",
    quantity: Number(t.quantity.toString()),
    price: Number(t.price.toString()),
    currencyCode: t.currencyCode,
    grossAmount: Number(t.grossAmount.toString()),
    fees: Number(t.fees.toString()),
  }));

  const corporateEventDates = eventRows.map((e) => isoDay(e.effectiveDate));
  const corporateEvents = toAdjustmentEvents(
    eventRows.map((e) => ({
      instrumentId,
      eventType: e.eventType,
      effectiveDate: isoDay(e.effectiveDate),
      numerator: e.numerator.toString(),
      denominator: e.denominator.toString(),
    }))
  ).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  const tradeDates = [...new Set(trades.map((t) => t.tradeDate))];
  const bounds = tradeQueryBounds(tradeDates, PROJECTION_WINDOW_DAYS);
  if (!bounds) {
    return { trades, corporateEventDates, corporateEvents, nativeArsCloses: [], cclByDate: [] };
  }
  const from = startOfDayUtc(bounds.from);
  const to = startOfDayUtc(bounds.to);

  // Only the [first trade - 7d, last trade] slice is read, then narrowed to the per-trade windows.
  const [closeRows, cclRows] = await Promise.all([
    prisma.priceCache.findMany({
      where: {
        instrumentId,
        source: { in: [DATA912_EOD_SOURCE, YAHOO_EOD_SOURCE] },
        datetime: { gte: from, lte: to },
      },
      orderBy: { datetime: "asc" },
      select: { datetime: true, close: true, source: true },
    }),
    prisma.fxRate.findMany({
      where: {
        baseCurrencyCode: "USD",
        quoteCurrencyCode: "ARS",
        source: "CCL",
        date: { gte: from, lte: to },
      },
      orderBy: { date: "asc" },
      select: { date: true, mid: true },
    }),
  ]);

  // Prefer data912-eod, fall back to yahoo-eod per date.
  const closeByDate = new Map<string, { close: number; source: string }>();
  for (const row of closeRows) {
    const date = isoDay(row.datetime);
    const existing = closeByDate.get(date);
    if (existing && existing.source === DATA912_EOD_SOURCE) continue;
    if (existing && row.source !== DATA912_EOD_SOURCE) continue;
    closeByDate.set(date, { close: Number(row.close.toString()), source: row.source });
  }
  // yahoo-eod is split-adjusted retroactively while trade prices are raw: a fallback close from
  // before a corporate event is not comparable, so drop it (projection then degrades to approximate).
  const nativeArsCloses = [...closeByDate.entries()]
    .filter(
      ([date, v]) =>
        v.source !== YAHOO_EOD_SOURCE || !corporateEventDates.some((d) => d > date)
    )
    .map(([date, v]) => ({ date, close: v.close }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const cclByDate = selectPointsInWindows(
    cclRows.map((r) => ({ date: isoDay(r.date), rate: Number(r.mid) })),
    tradeDates,
    PROJECTION_WINDOW_DAYS
  );

  return { trades, corporateEventDates, corporateEvents, nativeArsCloses, cclByDate };
}
