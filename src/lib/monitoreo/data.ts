import { Prisma, type InstrumentType } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchLiveQuoteFromData912 } from "@/lib/market/data912-live";
import { fetchData912History } from "@/lib/market/data912-history";
import { fetchFmpHistory } from "@/lib/market/fmp";
import { buildYahooSymbol, fetchYahooHistory } from "@/lib/market/yahoo";
import {
  DATA912_EOD_SOURCE,
  DATA912_LIVE_SOURCE,
  FMP_EOD_SOURCE,
  resolveMonitoringRouting,
  YAHOO_EOD_SOURCE,
  YAHOO_UNDERLYING_EOD_SOURCE,
  type ResolvableInstrument,
} from "@/lib/market/provider-routing";
import type {
  MonitoringBar,
  MonitoringCacheCoverage,
  MonitoringInstrument,
  MonitoringSeriesKind,
} from "./types";

const REVISION_WINDOW_DAYS = 5;

/** Midnight UTC date */
export function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function twoYearsAgoUtc(): Date {
  const today = todayUtc();
  return new Date(
    Date.UTC(today.getUTCFullYear() - 2, today.getUTCMonth(), today.getUTCDate())
  );
}

/** Defensive type guard for snapshot positions */
function isPositionRecord(item: unknown): item is { instrumentId?: string; ticker?: string } {
  return typeof item === "object" && item !== null;
}

/**
 * List all active BYMA instruments suitable for monitoring with portfolio and cache coverage metadata.
 */
export async function listMonitoringInstruments(
  userId?: string
): Promise<MonitoringInstrument[]> {
  const twoYearsAgo = twoYearsAgoUtc();

  // 1. Query active BYMA instruments
  const instruments = await prisma.instrument.findMany({
    where: {
      active: true,
      venueCode: "BYMA",
      type: { in: ["STOCK_AR", "CEDEAR"] },
    },
    include: {
      underlyingAsset: { select: { ticker: true } },
    },
    orderBy: { ticker: "asc" },
  });

  // 2. Identify in-portfolio instruments
  const portfolioInstrumentIds = new Set<string>();
  const portfolioTickers = new Set<string>();

  if (userId) {
    const portfolio = await prisma.portfolio.findFirst({
      where: { userId, archivedAt: null },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true },
    });

    if (portfolio) {
      const [transactions, snapshots] = await Promise.all([
        prisma.transaction.findMany({
          where: { portfolioId: portfolio.id, instrumentId: { not: null } },
          select: { instrumentId: true },
          distinct: ["instrumentId"],
        }),
        prisma.portfolioSnapshot.findMany({
          where: { portfolioId: portfolio.id },
          select: { positions: true },
          orderBy: { date: "desc" },
          take: 30,
        }),
      ]);

      for (const tx of transactions) {
        if (tx.instrumentId) portfolioInstrumentIds.add(tx.instrumentId);
      }

      for (const snap of snapshots) {
        if (Array.isArray(snap.positions)) {
          for (const pos of snap.positions) {
            if (isPositionRecord(pos)) {
              if (pos.instrumentId) portfolioInstrumentIds.add(pos.instrumentId);
              if (pos.ticker) portfolioTickers.add(pos.ticker.toUpperCase());
            }
          }
        }
      }
    }
  }

  // 3. Query cache coverage for all instruments (only valid EOD monitoring sources)
  const instrumentIds = instruments.map((i) => i.id);
  const cacheStats = await prisma.priceCache.groupBy({
    by: ["instrumentId"],
    where: {
      instrumentId: { in: instrumentIds },
      source: { in: [DATA912_EOD_SOURCE, YAHOO_EOD_SOURCE, YAHOO_UNDERLYING_EOD_SOURCE, FMP_EOD_SOURCE] },
      datetime: { gte: twoYearsAgo },
    },
    _count: { datetime: true },
    _min: { datetime: true },
    _max: { datetime: true },
  });

  const statsMap = new Map<
    string,
    { count: number; oldest: string | null; latest: string | null }
  >();

  for (const s of cacheStats) {
    statsMap.set(s.instrumentId, {
      count: s._count.datetime,
      oldest: s._min.datetime ? s._min.datetime.toISOString().slice(0, 10) : null,
      latest: s._max.datetime ? s._max.datetime.toISOString().slice(0, 10) : null,
    });
  }

  // 4. Map to MonitoringInstrument DTO
  return instruments.map((inst) => {
    const stats = statsMap.get(inst.id);
    const count = stats?.count ?? 0;
    let cacheCoverage: MonitoringCacheCoverage = "none";
    if (count >= 200) {
      cacheCoverage = "two-years";
    } else if (count >= 15) {
      cacheCoverage = "partial";
    }

    const isCedear = inst.type === "CEDEAR";
    const availableSources = [DATA912_EOD_SOURCE, YAHOO_EOD_SOURCE];
    if (isCedear) {
      availableSources.push(YAHOO_UNDERLYING_EOD_SOURCE, FMP_EOD_SOURCE);
    }

    const inPortfolio =
      portfolioInstrumentIds.has(inst.id) || portfolioTickers.has(inst.ticker.toUpperCase());

    return {
      id: inst.id,
      ticker: inst.ticker,
      name: inst.name,
      type: inst.type,
      nativeCurrency: inst.currencyCode,
      isCedear,
      underlyingTicker: inst.underlyingAsset?.ticker ?? null,
      inPortfolio,
      supported: true,
      availableSources,
      unavailableReason: null,
      cacheCoverage,
      oldestCachedDate: stats?.oldest ?? null,
      latestCachedDate: stats?.latest ?? null,
    };
  });
}

/**
 * Load cached OHLCV bars from PriceCache for a given instrument and source.
 */
export async function loadCachedMonitoringBars(
  instrumentId: string,
  source: string,
  from: Date = twoYearsAgoUtc(),
  to: Date = todayUtc()
): Promise<MonitoringBar[]> {
  const rows = await prisma.priceCache.findMany({
    where: {
      instrumentId,
      source,
      datetime: { gte: from, lte: to },
    },
    orderBy: { datetime: "asc" },
    select: {
      datetime: true,
      open: true,
      high: true,
      low: true,
      close: true,
      volume: true,
    },
  });

  return rows.map((r) => ({
    time: r.datetime.toISOString().slice(0, 10),
    open: r.open ? Number(r.open.toString()) : null,
    high: r.high ? Number(r.high.toString()) : null,
    low: r.low ? Number(r.low.toString()) : null,
    close: Number(r.close.toString()),
    volume: r.volume ? Number(r.volume.toString()) : null,
  }));
}

/**
 * Fallback to live Data912 quote and save to PriceCache as data912-live.
 */
export async function loadExternalLatestQuote(
  instrument: ResolvableInstrument
): Promise<MonitoringBar | null> {
  const quote = await fetchLiveQuoteFromData912(instrument.ticker, instrument.type);
  if (!quote) return null;

  const now = new Date();
  const bucketMs = 300 * 1000;
  const bucketedNow = new Date(Math.floor(now.getTime() / bucketMs) * bucketMs);
  const dateStr = now.toISOString().slice(0, 10);

  try {
    await prisma.priceCache.upsert({
      where: {
        instrumentId_datetime_source: {
          instrumentId: instrument.id,
          datetime: bucketedNow,
          source: DATA912_LIVE_SOURCE,
        },
      },
      create: {
        instrumentId: instrument.id,
        datetime: bucketedNow,
        close: new Prisma.Decimal(quote.close),
        volume: quote.volume ? new Prisma.Decimal(quote.volume) : null,
        source: DATA912_LIVE_SOURCE,
      },
      update: {
        close: new Prisma.Decimal(quote.close),
        volume: quote.volume ? new Prisma.Decimal(quote.volume) : null,
      },
    });
  } catch (err) {
    console.error("Failed to persist live quote:", err);
  }

  return {
    time: dateStr,
    open: null,
    high: null,
    low: null,
    close: quote.close,
    volume: quote.volume,
  };
}

/**
 * Fetch external historical bars from primary provider with fallback.
 */
export async function loadExternalMonitoringHistory(
  instrument: ResolvableInstrument,
  seriesKind: MonitoringSeriesKind
): Promise<{
  bars: MonitoringBar[];
  provider: "data912" | "yahoo" | "fmp" | "derived";
  source: string;
  error?: string;
}> {
  const routing = resolveMonitoringRouting(instrument, seriesKind);
  const fullHistoryFrom = new Date(Date.UTC(new Date().getUTCFullYear() - 10, 0, 1));

  // 1. Data912 primary
  if (routing.provider === "data912") {
    const res = await fetchData912History(instrument.ticker, instrument.type);
    if (res.bars.length > 0) {
      return { bars: res.bars, provider: "data912", source: routing.source };
    }

    // Fallback to Yahoo if Data912 fails or has no bars
    try {
      const yahooSym = buildYahooSymbol(instrument.ticker, true);
      const yahooRes = await fetchYahooHistory(yahooSym, {
        from: fullHistoryFrom,
        to: new Date(),
      });
      if (yahooRes.bars.length > 0) {
        return {
          bars: yahooRes.bars.map((b) => ({
            time: b.date.toISOString().slice(0, 10),
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
          })),
          provider: "yahoo",
          source: YAHOO_EOD_SOURCE,
        };
      }
    } catch {
      // Yahoo fallback failed
    }

    return {
      bars: [],
      provider: "data912",
      source: routing.source,
      error: res.error || "Sin datos en Data912",
    };
  }

  // 2. FMP primary (for USD underlying)
  if (routing.provider === "fmp") {
    const res = await fetchFmpHistory(routing.externalSymbol, { nonSplitAdjusted: true });
    if (res.bars.length > 0) {
      return { bars: res.bars, provider: "fmp", source: routing.source };
    }

    // Fallback to Yahoo without .BA
    try {
      const yahooRes = await fetchYahooHistory(routing.externalSymbol, {
        from: fullHistoryFrom,
        to: new Date(),
      });
      if (yahooRes.bars.length > 0) {
        return {
          bars: yahooRes.bars.map((b) => ({
            time: b.date.toISOString().slice(0, 10),
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
            volume: b.volume,
          })),
          provider: "yahoo",
          source: YAHOO_UNDERLYING_EOD_SOURCE,
        };
      }
    } catch {
      // Yahoo fallback failed
    }

    return {
      bars: [],
      provider: "fmp",
      source: routing.source,
      error: res.error || "Sin datos en FMP",
    };
  }

  // 3. Yahoo primary
  if (routing.provider === "yahoo") {
    try {
      const yahooRes = await fetchYahooHistory(routing.externalSymbol, {
        from: fullHistoryFrom,
        to: new Date(),
      });
      return {
        bars: yahooRes.bars.map((b) => ({
          time: b.date.toISOString().slice(0, 10),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        })),
        provider: "yahoo",
        source: routing.source,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { bars: [], provider: "yahoo", source: routing.source, error: msg };
    }
  }

  return { bars: [], provider: "derived", source: routing.source, error: "Modo no soportado" };
}

/**
 * Persist missing historical bars to PriceCache within the 2-year retention window.
 * Revises recent window in case of adjustments.
 */
export async function persistMissingRecentBars(
  instrumentId: string,
  source: string,
  bars: MonitoringBar[],
  retentionFrom: Date = twoYearsAgoUtc()
): Promise<number> {
  if (bars.length === 0) return 0;

  const retentionCutoffStr = retentionFrom.toISOString().slice(0, 10);
  const eligibleBars = bars.filter((b) => b.time >= retentionCutoffStr);
  if (eligibleBars.length === 0) return 0;

  const dates = eligibleBars.map((b) => new Date(`${b.time}T00:00:00.000Z`));
  const existingRows = await prisma.priceCache.findMany({
    where: {
      instrumentId,
      source,
      datetime: { in: dates },
    },
    select: { datetime: true },
  });

  const existingTimes = new Set(existingRows.map((r) => r.datetime.toISOString().slice(0, 10)));
  const revisionCutoff = new Date(Date.now() - REVISION_WINDOW_DAYS * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

  const toInsert = eligibleBars.filter(
    (b) => !existingTimes.has(b.time) && b.time < revisionCutoff
  );
  const toRevise = eligibleBars.filter((b) => b.time >= revisionCutoff);

  let insertedCount = 0;

  if (toInsert.length > 0) {
    const created = await prisma.priceCache.createMany({
      data: toInsert.map((b) => ({
        instrumentId,
        datetime: new Date(`${b.time}T00:00:00.000Z`),
        open: b.open !== null ? new Prisma.Decimal(b.open) : null,
        high: b.high !== null ? new Prisma.Decimal(b.high) : null,
        low: b.low !== null ? new Prisma.Decimal(b.low) : null,
        close: new Prisma.Decimal(b.close),
        volume: b.volume !== null ? new Prisma.Decimal(b.volume) : null,
        source,
      })),
      skipDuplicates: true,
    });
    insertedCount += created.count;
  }

  for (const b of toRevise) {
    const date = new Date(`${b.time}T00:00:00.000Z`);
    try {
      await prisma.priceCache.upsert({
        where: {
          instrumentId_datetime_source: {
            instrumentId,
            datetime: date,
            source,
          },
        },
        create: {
          instrumentId,
          datetime: date,
          open: b.open !== null ? new Prisma.Decimal(b.open) : null,
          high: b.high !== null ? new Prisma.Decimal(b.high) : null,
          low: b.low !== null ? new Prisma.Decimal(b.low) : null,
          close: new Prisma.Decimal(b.close),
          volume: b.volume !== null ? new Prisma.Decimal(b.volume) : null,
          source,
        },
        update: {
          open: b.open !== null ? new Prisma.Decimal(b.open) : null,
          high: b.high !== null ? new Prisma.Decimal(b.high) : null,
          low: b.low !== null ? new Prisma.Decimal(b.low) : null,
          close: new Prisma.Decimal(b.close),
          volume: b.volume !== null ? new Prisma.Decimal(b.volume) : null,
        },
      });
      insertedCount++;
    } catch {
      // Ignore individual upsert error
    }
  }

  return insertedCount;
}
