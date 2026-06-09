"use server";

import Decimal from "decimal.js";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aggregateReceivedDividends } from "@/lib/dividends/aggregate";
import { buildDividendsPageData } from "@/lib/dividends/build";
import { forecastUpcomingDividends, type HoldingForForecast } from "@/lib/dividends/forecast";
import type { DividendsPageData } from "@/lib/dividends/types";
import { TransactionType, type InstrumentType } from "@/lib/generated/prisma";

const HOLDABLE_TYPES: InstrumentType[] = ["STOCK_AR", "CEDEAR", "STOCK_US", "ETF"];

function computeHoldings(
  trades: Array<{
    ticker: string;
    instrumentName: string;
    instrumentType: InstrumentType;
    type: TransactionType;
    quantity: string;
    tradeDate: string;
  }>
): HoldingForForecast[] {
  const byTicker = new Map<
    string,
    { ticker: string; instrumentName: string; instrumentType: InstrumentType; qty: Decimal }
  >();

  const sorted = [...trades].sort(
    (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
  );

  for (const t of sorted) {
    const key = t.ticker.toUpperCase();
    const current = byTicker.get(key) ?? {
      ticker: key,
      instrumentName: t.instrumentName,
      instrumentType: t.instrumentType,
      qty: new Decimal(0),
    };
    const q = new Decimal(t.quantity).abs();
    if (t.type === TransactionType.BUY) {
      current.qty = current.qty.plus(q);
    } else if (t.type === TransactionType.SELL) {
      current.qty = current.qty.minus(q);
      if (current.qty.lt(0)) current.qty = new Decimal(0);
    }
    byTicker.set(key, current);
  }

  return Array.from(byTicker.values())
    .filter((h) => h.qty.gt(0))
    .map((h) => ({
      ticker: h.ticker,
      instrumentName: h.instrumentName,
      instrumentType: h.instrumentType,
      quantity: h.qty.toFixed(8).replace(/\.?0+$/, ""),
    }));
}

export async function getDividendsPageDataAction(): Promise<
  DividendsPageData | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const [dividendsAndTaxes, tradeRows, latestFx] = await Promise.all([
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
      },
      orderBy: { tradeDate: "asc" },
      include: {
        instrument: { select: { id: true, ticker: true, type: true, name: true } },
      },
    }),
    prisma.fxRate.findFirst({
      where: { baseCurrencyCode: "USD", quoteCurrencyCode: "ARS" },
      orderBy: { date: "desc" },
    }),
  ]);

  const cclRate = latestFx ? Number(latestFx.mid) : null;

  const received = aggregateReceivedDividends(dividendsAndTaxes);

  const holdings = computeHoldings(
    tradeRows
      .filter((r) => r.instrument)
      .map((r) => ({
        ticker: r.instrument!.ticker,
        instrumentName: r.instrument!.name,
        instrumentType: r.instrument!.type,
        type: r.type,
        quantity: r.quantity.toString(),
        tradeDate: r.tradeDate.toISOString(),
      }))
  );

  const { upcoming, errors } = await forecastUpcomingDividends(holdings, 6);

  return buildDividendsPageData({
    received,
    upcoming,
    holdings: holdings.map((h) => ({
      ticker: h.ticker,
      quantity: h.quantity,
      instrumentName: h.instrumentName,
    })),
    cclRate,
    yahooErrors: errors,
  });
}
