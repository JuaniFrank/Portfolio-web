"use server";

import { getCurrentUser } from "@/lib/auth";
import { buildBondsPageData, type TradeForBonds } from "@/lib/bonds/build";
import type {
  BondsPageDataV2,
  BondHoldingV2,
  BondAnalytics,
  UpcomingFlow,
} from "@/lib/bonds/types";
import { fetchOnPrices } from "@/lib/market/data912";
import { fetchCclQuote } from "@/lib/market/dolarapi";
import { prisma } from "@/lib/prisma";
import { TransactionType } from "@/lib/generated/prisma";
import { projectCashFlows, type BondTermsForProjection } from "@/lib/bonds/cashflows";
import { computeBondAnalytics, type CashFlow } from "@/lib/bonds/analytics";

export async function getBondsPageDataAction(): Promise<
  BondsPageDataV2 | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  // Query all ON transactions — scoped exclusively to instrumentType "ON".
  // TRADE_INSTRUMENT_TYPES is intentionally not touched here.
  const txRows = await prisma.transaction.findMany({
    where: {
      portfolio: { userId: user.id },
      type: {
        in: [
          TransactionType.BUY,
          TransactionType.SELL,
          TransactionType.COUPON,
          TransactionType.AMORTIZATION,
        ],
      },
      instrument: { type: "ON" },
      instrumentId: { not: null },
    },
    orderBy: { tradeDate: "asc" },
    include: {
      instrument: {
        select: {
          id: true,
          ticker: true,
          type: true,
          bondTerms: true,
        },
      },
    },
  });

  // Collect unique tickers for the price fetch
  const tickers = Array.from(
    new Set(
      txRows
        .filter((r) => r.instrument !== null)
        .map((r) => r.instrument!.ticker.toUpperCase())
    )
  );

  const [priceResult, cclQuote] = await Promise.all([
    fetchOnPrices(tickers),
    fetchCclQuote(),
  ]);

  const cclMid = cclQuote?.mid ?? null;

  // Build BondTerms map: instrumentId → BondTermsForProjection
  const bondTermsMap = new Map<string, BondTermsForProjection>();
  for (const row of txRows) {
    if (row.instrument?.bondTerms) {
      const bt = row.instrument.bondTerms;
      bondTermsMap.set(bt.instrumentId, {
        faceValue: bt.faceValue.toString(),
        currencyCode: bt.currencyCode,
        rateType: bt.rateType as "FIXED" | "FLOATING",
        couponRate: bt.couponRate.toString(),
        couponFrequencyMonths: bt.couponFrequencyMonths,
        issueDate: bt.issueDate,
        maturityDate: bt.maturityDate,
        amortizationSchedule: bt.amortizationSchedule,
        dayCountConvention: bt.dayCountConvention,
      });
    }
  }

  // Map Prisma rows to the shape expected by buildBondsPageData.
  // TradeForBondHoldings.type is now widened to `string` (batch-3 quality debt fix),
  // so no unsafe cast is needed.
  const trades: TradeForBonds[] = txRows
    .filter((r) => r.instrument !== null)
    .map((r) => ({
      instrumentId: r.instrument!.id,
      ticker: r.instrument!.ticker,
      type: r.type as string,
      quantity: r.quantity.toString(),
      netAmount: r.netAmount.toString(),
      currencyCode: r.currencyCode,
      tradeDate: r.tradeDate.toISOString(),
    }));

  // Build v1 page data
  const v1Data = buildBondsPageData(trades, priceResult, cclMid);

  // Augment each holding with analytics and projected flows (v2)
  const holdingsV2: BondHoldingV2[] = v1Data.holdings.map((holding) => {
    const terms = bondTermsMap.get(holding.instrumentId);
    const hasTerms = !!terms;

    if (!hasTerms) {
      return {
        ...holding,
        analytics: {
          ytm: null,
          macaulayDuration: null,
          modifiedDuration: null,
          noConvergence: false,
          noTerms: true,
          invalidPrice: false,
          matured: false,
        } satisfies BondAnalytics,
        projectedFlows: [],
        hasTerms: false,
      };
    }

    // Project cash flows
    const projected = projectCashFlows(terms);

    // Convert projected flows to CashFlow[] for analytics
    const cashFlowsForAnalytics: CashFlow[] = projected.map((f) => ({
      t: f.t,
      amount: f.amount,
    }));

    // Get USD price for analytics (marketValueUsd / nominalHeld when available)
    let priceUsd: number | null = null;
    if (holding.marketValueUsd !== null && Number(holding.nominalHeld) > 0) {
      // Approximate price per unit in USD: marketValueUsd / nominalHeld
      // For analytics, use total present value (price = marketValueUsd represents the full position)
      // We compute YTM on the basis of nominalHeld × unit face-value flows vs. total market value
      priceUsd = parseFloat(holding.marketValueUsd);
    }

    const periodsPerYear = 12 / terms.couponFrequencyMonths;
    const analyticsResult = computeBondAnalytics(
      cashFlowsForAnalytics,
      priceUsd,
      periodsPerYear,
      true
    );

    const analytics: BondAnalytics = {
      ytm: analyticsResult.ytm,
      macaulayDuration: analyticsResult.macaulayDuration,
      modifiedDuration: analyticsResult.modifiedDuration,
      noConvergence: analyticsResult.noConvergence,
      noTerms: false,
      invalidPrice: analyticsResult.invalidPrice,
      matured: analyticsResult.matured,
    };

    const upcomingFlows: UpcomingFlow[] = projected.map((f) => ({
      date: f.date,
      flowType: f.flowType,
      amount: f.amount.toFixed(8).replace(/\.?0+$/, "") || "0",
      assumedRate: f.assumedRate,
    }));

    return {
      ...holding,
      analytics,
      projectedFlows: upcomingFlows,
      hasTerms: true,
    };
  });

  return {
    ...v1Data,
    holdings: holdingsV2,
  };
}
