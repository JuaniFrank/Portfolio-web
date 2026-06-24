"use server";

import { getCurrentUser } from "@/lib/auth";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import { aggregateReceivedDividends } from "@/lib/dividends/aggregate";
import { buildDividendsPageData } from "@/lib/dividends/build";
import { forecastUpcomingDividends, type HoldingForForecast } from "@/lib/dividends/forecast";
import type { DividendsPageData } from "@/lib/dividends/types";
import { fetchCclQuote } from "@/lib/market/dolarapi";
import { prisma } from "@/lib/prisma";
import { buildHoldings, type TradeForHoldings } from "@/lib/transactions/holdings";
import { TransactionType, type InstrumentType } from "@/lib/generated/prisma";

const HOLDABLE_TYPES: InstrumentType[] = ["STOCK_AR", "CEDEAR", "STOCK_US", "ETF"];

export async function getDividendsPageDataAction(): Promise<
  DividendsPageData | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const [dividendsAndTaxes, tradeRows, cclQuote, eventRows] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        portfolio: { userId: user.id },
        type: { in: [TransactionType.DIVIDEND_CASH, TransactionType.TAX_WITHHOLDING] },
      },
      orderBy: { tradeDate: "desc" },
      include: {
        instrument: { select: { id: true, ticker: true, type: true, name: true } },
      },
    }),
    prisma.transaction.findMany({
      where: {
        portfolio: { userId: user.id },
        type: { in: [TransactionType.BUY, TransactionType.SELL] },
        instrument: { type: { in: HOLDABLE_TYPES } },
        instrumentId: { not: null },
      },
      orderBy: { tradeDate: "asc" },
      include: {
        instrument: { select: { id: true, ticker: true, type: true, name: true } },
      },
    }),
    fetchCclQuote(),
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

  const cclToday = cclQuote?.mid ?? null;

  const received = aggregateReceivedDividends(dividendsAndTaxes);

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

  // Map to TradeForHoldings (price + netAmount required for buildHoldings)
  const tradesForHoldings: TradeForHoldings[] = tradeRows
    .filter((r) => r.instrument)
    .map((r) => ({
      instrumentId: r.instrument!.id,
      ticker: r.instrument!.ticker,
      instrumentType: r.instrument!.type,
      instrumentName: r.instrument!.name,
      type: r.type as "BUY" | "SELL",
      quantity: r.quantity.toString(),
      price: r.price.toString(),
      netAmount: r.netAmount.toString(),
      tradeDate: r.tradeDate.toISOString(),
    }));

  // Use empty prices map — dividends page only needs quantity, not market value
  const holdingRows = buildHoldings(tradesForHoldings, new Map(), eventsMap);

  // Map HoldingRow → HoldingForForecast
  const holdings: HoldingForForecast[] = holdingRows.map((h) => ({
    ticker: h.ticker,
    instrumentName: h.instrumentName,
    instrumentType: h.instrumentType,
    quantity: h.quantity,
  }));

  const { upcoming, errors } = await forecastUpcomingDividends(holdings, 6);

  return buildDividendsPageData({
    received,
    upcoming,
    holdings: holdings.map((h) => ({
      ticker: h.ticker,
      quantity: h.quantity,
      instrumentName: h.instrumentName,
    })),
    cclToday,
    yahooErrors: errors,
  });
}
