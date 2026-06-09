"use server";

import { getCurrentUser } from "@/lib/auth";
import { refreshLatestQuotes, type InstrumentForQuote } from "@/lib/market/quotes";
import { prisma } from "@/lib/prisma";
import {
  buildHoldings,
  computePortfolioSummary,
} from "@/lib/transactions/holdings";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import type { TradeHistoryRow, TransactionsPageData } from "@/lib/transactions/types";
import { TRADE_INSTRUMENT_TYPES, TRADE_TYPES } from "@/lib/transactions/types";

function toUsdPrice(priceArs: number, cclRate: number | null): string | null {
  if (!cclRate || cclRate <= 0) return null;
  return (priceArs / cclRate).toFixed(2);
}

export async function getTransactionsPageDataAction(): Promise<
  TransactionsPageData | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const [rows, latestFx] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        portfolio: { userId: user.id },
        type: { in: TRADE_TYPES },
        instrument: { type: { in: TRADE_INSTRUMENT_TYPES } },
        instrumentId: { not: null },
      },
      orderBy: { tradeDate: "desc" },
      include: {
        instrument: {
          select: { id: true, ticker: true, name: true, type: true },
        },
        importBatch: {
          select: { broker: { select: { code: true, name: true } } },
        },
        tags: { include: { tag: { select: { name: true } } } },
      },
    }),
    prisma.fxRate.findFirst({
      where: {
        baseCurrencyCode: "USD",
        quoteCurrencyCode: "ARS",
      },
      orderBy: { date: "desc" },
    }),
  ]);

  const cclRate = latestFx ? Number(latestFx.mid) : null;

  const tradesForHoldings: TradeForHoldings[] = [];
  const history: TradeHistoryRow[] = [];

  for (const r of rows) {
    if (!r.instrument) continue;

    const priceArs = Number(r.price);
    const qty = Number(r.quantity);

    tradesForHoldings.push({
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

    const tagFromDb = r.tags[0]?.tag.name;
    const tagFromBroker = r.importBatch?.broker.code.toLowerCase();
    const tagLabel = tagFromDb ?? tagFromBroker ?? null;

    const amountArs = Math.abs(Number(r.netAmount));

    history.push({
      id: r.id,
      tradeDate: r.tradeDate.toISOString(),
      type: r.type,
      ticker: r.instrument.ticker,
      instrumentType: r.instrument.type,
      instrumentName: r.instrument.name,
      quantity: qty.toString(),
      priceArs: r.price.toString(),
      priceUsd: toUsdPrice(priceArs, cclRate),
      amountArs: amountArs.toString(),
      amountUsd: toUsdPrice(amountArs, cclRate),
      currencyCode: r.currencyCode,
      tagLabel,
      source: r.source,
    });
  }

  const uniqueInstruments = new Map<string, InstrumentForQuote>();
  for (const t of tradesForHoldings) {
    if (!uniqueInstruments.has(t.instrumentId)) {
      uniqueInstruments.set(t.instrumentId, {
        id: t.instrumentId,
        ticker: t.ticker,
        type: t.instrumentType,
      });
    }
  }
  const { prices: latestPrices } = await refreshLatestQuotes([...uniqueInstruments.values()]);

  const holdings = buildHoldings(tradesForHoldings, latestPrices);
  const summaryBase = computePortfolioSummary(holdings);

  return {
    holdings,
    trades: history,
    summary: {
      ...summaryBase,
      cclRate: cclRate?.toFixed(2) ?? null,
    },
  };
}
