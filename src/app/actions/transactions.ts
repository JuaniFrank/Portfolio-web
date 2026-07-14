"use server";

import { getCurrentUser } from "@/lib/auth";
import {
  toBondTrade,
  toHoldingRow,
  valuateOnPositions,
} from "@/lib/bonds/portfolio-bridge";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import { fetchOnPrices } from "@/lib/market/data912";
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

function toArsFromUsd(amountUsd: number, cclRate: number | null): string {
  if (!cclRate || cclRate <= 0) return amountUsd.toFixed(2);
  return (amountUsd * cclRate).toFixed(2);
}

function tradePricesAndAmounts(
  price: number,
  netAmount: number,
  currencyCode: string,
  cclRate: number | null
): Pick<TradeHistoryRow, "priceArs" | "priceUsd" | "amountArs" | "amountUsd"> {
  const amountAbs = Math.abs(netAmount);

  if (currencyCode === "USD") {
    return {
      priceUsd: price.toFixed(2),
      priceArs: toArsFromUsd(price, cclRate),
      amountUsd: amountAbs.toFixed(2),
      amountArs: toArsFromUsd(amountAbs, cclRate),
    };
  }

  return {
    priceArs: price.toFixed(2),
    priceUsd: toUsdPrice(price, cclRate),
    amountArs: amountAbs.toFixed(2),
    amountUsd: toUsdPrice(amountAbs, cclRate),
  };
}

export async function getTransactionsPageDataAction(): Promise<
  TransactionsPageData | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const [rows, latestFx, eventRows] = await Promise.all([
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
    prisma.corporateEvent.findMany({
      where: {
        instrument: {
          transactions: { some: { portfolio: { userId: user.id } } },
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

  const cclRate = latestFx ? Number(latestFx.mid) : null;

  const tradesForHoldings: TradeForHoldings[] = [];
  const onBondTrades: ReturnType<typeof toBondTrade>[] = [];
  const onNamesById = new Map<string, string>();
  const history: TradeHistoryRow[] = [];

  for (const r of rows) {
    if (!r.instrument) continue;

    const price = Number(r.price);
    const qty = Number(r.quantity);
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
    } else {
      tradesForHoldings.push(trade);
    }

    const tagFromDb = r.tags[0]?.tag.name;
    const tagFromBroker = r.importBatch?.broker.code.toLowerCase();
    const tagLabel = tagFromDb ?? tagFromBroker ?? null;
    const { priceArs, priceUsd, amountArs, amountUsd } = tradePricesAndAmounts(
      price,
      Number(r.netAmount),
      r.currencyCode,
      cclRate
    );

    history.push({
      id: r.id,
      tradeDate: r.tradeDate.toISOString(),
      type: r.type,
      ticker: r.instrument.ticker,
      instrumentType: r.instrument.type,
      instrumentName: r.instrument.name,
      quantity: qty.toString(),
      priceArs,
      priceUsd,
      amountArs,
      amountUsd,
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

  const onTickers = Array.from(new Set(onBondTrades.map((t) => t.ticker.toUpperCase())));

  const [{ prices: latestPrices }, onPriceResult] = await Promise.all([
    refreshLatestQuotes([...uniqueInstruments.values()]),
    onTickers.length > 0 ? fetchOnPrices(onTickers) : Promise.resolve({ quotes: new Map(), stale: false }),
  ]);

  const equityHoldings = buildHoldings(tradesForHoldings, latestPrices, eventsMap);
  const onPositions = valuateOnPositions(onBondTrades, onPriceResult, cclRate, onNamesById);
  const onHoldings = onPositions.map((p) => toHoldingRow(p, cclRate));
  const holdings = [...equityHoldings, ...onHoldings].sort((a, b) =>
    a.ticker.localeCompare(b.ticker)
  );
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
