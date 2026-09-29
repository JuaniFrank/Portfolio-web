"use server";

import { getCurrentUser } from "@/lib/auth";
import { loadBondCashflowEntries } from "@/lib/bonds/cashflow-entries";
import { buildUpcomingIncome, type UpcomingIncomeResult } from "@/lib/dashboard/upcoming-income";
import { forecastUpcomingDividends, type HoldingForForecast } from "@/lib/dividends/forecast";
import type { UpcomingDividend } from "@/lib/dividends/types";
import { resolveCclRate } from "@/lib/market/ccl-rate";
import { prisma } from "@/lib/prisma";
import { TransactionType, type InstrumentType } from "@/lib/generated/prisma";
import { buildHoldings, type TradeForHoldings } from "@/lib/transactions/holdings";

const DIVIDEND_HOLDABLE_TYPES: InstrumentType[] = ["STOCK_AR", "CEDEAR", "STOCK_US", "ETF"];

export type UpcomingIncomeActionResult = UpcomingIncomeResult & {
  /**
   * `true` when the Yahoo-backed dividend forecast could not be computed for
   * at least one holding (offline/502 or an unexpected throw) — ON coupon
   * and amortization rows are still returned; only the dividend estimate
   * side of the panel is affected.
   */
  dividendsUnavailable: boolean;
};

/**
 * Server action for the dashboard's "Próximos cobros" panel. Loaded by the
 * client **after** the page renders (see `UpcomingIncomePanel`) so Yahoo's
 * per-ticker dividend cadence lookup — slow and external — never blocks the
 * rest of the dashboard.
 */
export async function getUpcomingIncomeAction(): Promise<
  UpcomingIncomeActionResult | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const portfolio = await prisma.portfolio.findFirst({
    where: { userId: user.id, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  if (!portfolio) {
    return { ...buildUpcomingIncome({ bondEntries: [], dividendEstimates: [], cclRate: null }), dividendsUnavailable: false };
  }

  const [bondEntries, cclRate, tradeRows] = await Promise.all([
    loadBondCashflowEntries({ portfolioIds: [portfolio.id] }),
    resolveCclRate(),
    prisma.transaction.findMany({
      where: {
        portfolioId: portfolio.id,
        type: { in: [TransactionType.BUY, TransactionType.SELL] },
        instrument: { type: { in: DIVIDEND_HOLDABLE_TYPES } },
        instrumentId: { not: null },
      },
      orderBy: { tradeDate: "asc" },
      include: {
        instrument: { select: { id: true, ticker: true, type: true, name: true } },
      },
    }),
  ]);

  const tradesForHoldings: TradeForHoldings[] = tradeRows
    .filter((r) => r.instrument !== null)
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

  // Dividends only need current quantity, not market value — empty prices map.
  const holdingRows = buildHoldings(tradesForHoldings, new Map());
  const holdingsForForecast: HoldingForForecast[] = holdingRows.map((h) => ({
    ticker: h.ticker,
    instrumentName: h.instrumentName,
    instrumentType: h.instrumentType,
    quantity: h.quantity,
  }));

  let dividendEstimates: UpcomingDividend[] = [];
  let dividendsUnavailable = false;
  try {
    const forecast = await forecastUpcomingDividends(holdingsForForecast, cclRate, 6);
    dividendEstimates = forecast.upcoming;
    dividendsUnavailable = forecast.errors.length > 0;
  } catch {
    // A hard throw (not the per-ticker try/catch already inside
    // forecastUpcomingDividends) still degrades to "no estimates" instead of
    // failing the whole panel — ON rows are unaffected.
    dividendsUnavailable = true;
  }

  const income = buildUpcomingIncome({ bondEntries, dividendEstimates, cclRate });

  return { ...income, dividendsUnavailable };
}
