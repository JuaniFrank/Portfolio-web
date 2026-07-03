"use server";

import { getCurrentUser } from "@/lib/auth";
import {
  toDashboardHolding,
  toBondTrade,
  valuateOnPositions,
} from "@/lib/bonds/portfolio-bridge";
import {
  buildDashboardData,
  type HoldingForDashboard,
} from "@/lib/dashboard/build";
import type { DashboardData } from "@/lib/dashboard/types";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import { fetchOnPrices } from "@/lib/market/data912";
import { resolveCclRate } from "@/lib/market/ccl-rate";
import { refreshLatestQuotes, type InstrumentForQuote } from "@/lib/market/quotes";
import { prisma } from "@/lib/prisma";
import {
  buildHoldings,
  type TradeForHoldings,
} from "@/lib/transactions/holdings";
import { TRADE_INSTRUMENT_TYPES, TRADE_TYPES } from "@/lib/transactions/types";

export async function getDashboardPageDataAction(): Promise<
  DashboardData | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const portfolio = await prisma.portfolio.findFirst({
    where: { userId: user.id, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });

  if (!portfolio) {
    return buildDashboardData({
      portfolioName: "Sin portfolio",
      rawHoldings: [],
      cclRate: null,
    });
  }

  const [rows, cclRate, eventRows] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        portfolioId: portfolio.id,
        type: { in: TRADE_TYPES },
        instrument: { type: { in: TRADE_INSTRUMENT_TYPES } },
        instrumentId: { not: null },
      },
      orderBy: { tradeDate: "asc" },
      include: {
        instrument: {
          select: {
            id: true,
            ticker: true,
            name: true,
            type: true,
            underlyingAsset: { select: { sector: true } },
          },
        },
      },
    }),
    resolveCclRate(),
    prisma.corporateEvent.findMany({
      where: {
        instrument: {
          transactions: { some: { portfolioId: portfolio.id } },
        },
      },
      orderBy: { effectiveDate: "asc" },
      select: {
        instrumentId: true,
        eventType: true,
        effectiveDate: true,
        numerator: true,
        denominator: true,
      },
    }),
  ]);

  // Build events map: instrumentId → events sorted ascending by effectiveDate
  const eventsMap = new Map<string, CorporateEventForBuilder[]>();
  for (const e of eventRows) {
    const list = eventsMap.get(e.instrumentId) ?? [];
    list.push({
      instrumentId: e.instrumentId,
      eventType: e.eventType,
      effectiveDate: e.effectiveDate.toISOString().slice(0, 10),
      numerator: e.numerator.toString(),
      denominator: e.denominator.toString(),
    });
    eventsMap.set(e.instrumentId, list);
  }

  const trades: TradeForHoldings[] = [];
  const onBondTrades: ReturnType<typeof toBondTrade>[] = [];
  const sectorByInstrument = new Map<string, string | null>();
  const onNamesById = new Map<string, string>();

  for (const r of rows) {
    if (!r.instrument) continue;
    const trade: TradeForHoldings = {
      instrumentId: r.instrument.id,
      ticker: r.instrument.ticker,
      instrumentType: r.instrument.type,
      instrumentName: r.instrument.name,
      type: r.type as "BUY" | "SELL",
      quantity: r.quantity.toString(),
      price: r.price.toString(),
      netAmount: r.netAmount.toString(),
      tradeDate: r.tradeDate.toISOString(),
    };

    if (r.instrument.type === "ON") {
      onBondTrades.push(toBondTrade(trade, r.currencyCode));
      onNamesById.set(r.instrument.id, r.instrument.name);
      continue;
    }

    trades.push(trade);
    sectorByInstrument.set(r.instrument.id, r.instrument.underlyingAsset?.sector ?? null);
  }

  const uniqueInstruments = new Map<string, InstrumentForQuote>();
  for (const t of trades) {
    if (!uniqueInstruments.has(t.instrumentId)) {
      uniqueInstruments.set(t.instrumentId, {
        id: t.instrumentId,
        ticker: t.ticker,
        type: t.instrumentType,
      });
    }
  }

  const onTickers = Array.from(new Set(onBondTrades.map((t) => t.ticker.toUpperCase())));

  const [{ prices }, onPriceResult] = await Promise.all([
    refreshLatestQuotes([...uniqueInstruments.values()]),
    onTickers.length > 0 ? fetchOnPrices(onTickers) : Promise.resolve({ quotes: new Map(), stale: false }),
  ]);

  const equityHoldings = buildHoldings(trades, prices, eventsMap);
  const onPositions = valuateOnPositions(onBondTrades, onPriceResult, cclRate, onNamesById);

  const rawHoldings: HoldingForDashboard[] = [
    ...equityHoldings.map((h) => ({
      instrumentId: h.instrumentId,
      ticker: h.ticker,
      instrumentName: h.instrumentName,
      instrumentType: h.instrumentType,
      quantity: h.quantity,
      costBasisArs: h.costBasisArs,
      marketValueArs: h.marketValueArs,
      pnlArs: h.pnlArs,
      pnlPercent: h.pnlPercent,
      sector: sectorByInstrument.get(h.instrumentId) ?? null,
    })),
    ...onPositions.map((p) => toDashboardHolding(p, cclRate)),
  ];

  return buildDashboardData({
    portfolioName: portfolio.name,
    rawHoldings,
    cclRate,
  });
}
