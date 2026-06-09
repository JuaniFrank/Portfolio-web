"use server";

import { getCurrentUser } from "@/lib/auth";
import {
  buildDashboardData,
  type HoldingForDashboard,
} from "@/lib/dashboard/build";
import type { DashboardData } from "@/lib/dashboard/types";
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

  const [rows, latestFx] = await Promise.all([
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
    prisma.fxRate.findFirst({
      where: { baseCurrencyCode: "USD", quoteCurrencyCode: "ARS" },
      orderBy: { date: "desc" },
    }),
  ]);

  const cclRate = latestFx ? Number(latestFx.mid) : null;

  const trades: TradeForHoldings[] = [];
  const sectorByInstrument = new Map<string, string | null>();

  for (const r of rows) {
    if (!r.instrument) continue;
    trades.push({
      instrumentId: r.instrument.id,
      ticker: r.instrument.ticker,
      instrumentType: r.instrument.type,
      instrumentName: r.instrument.name,
      type: r.type as "BUY" | "SELL",
      quantity: r.quantity.toString(),
      price: r.price.toString(),
      netAmount: r.netAmount.toString(),
      tradeDate: r.tradeDate.toISOString(),
    });
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

  const { prices } = await refreshLatestQuotes([...uniqueInstruments.values()]);
  const holdings = buildHoldings(trades, prices);

  const rawHoldings: HoldingForDashboard[] = holdings.map((h) => ({
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
  }));

  return buildDashboardData({
    portfolioName: portfolio.name,
    rawHoldings,
    cclRate,
  });
}
