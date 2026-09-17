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
import {
  buildBondCashflowOutlook,
  scaleFlowsToHolding,
  type BondCashflowEntry,
  type BondTermsForProjection,
  type ProjectedFlow,
} from "@/lib/bonds/cashflows";
import { computeBondAnalytics, type CashFlow } from "@/lib/bonds/analytics";
import { resolveBondSchedule, type BondScheduleRow } from "@/lib/bonds/schedule-source";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** AD-14: Docta's stored schedule has no COUPON/AMORTIZATION distinction of
 * its own (one row combines both) — split by whichever component of the row
 * is non-zero, matching the shape `projectCashFlows` already produces. */
function scheduleRowsToProjectedFlows(rows: BondScheduleRow[], today: Date): ProjectedFlow[] {
  const todayTime = today.getTime();
  return rows
    .filter((r) => new Date(r.paymentDate).getTime() > todayTime)
    .flatMap((r): ProjectedFlow[] => {
      const t = (new Date(r.paymentDate).getTime() - todayTime) / MS_PER_YEAR;
      const flows: ProjectedFlow[] = [];
      if (r.interestAmount > 0) {
        flows.push({ date: r.paymentDate, amount: r.interestAmount, t, flowType: "COUPON", assumedRate: false, periodDays: null });
      }
      if (r.capital > 0) {
        flows.push({ date: r.paymentDate, amount: r.capital, t, flowType: "AMORTIZATION", assumedRate: false, periodDays: null });
      }
      return flows;
    });
}

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
          bondSchedule: true,
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

  // Build BondSchedule map: instrumentId → stored rows (AD-14, T-51)
  const bondScheduleMap = new Map<string, BondScheduleRow[]>();
  for (const row of txRows) {
    if (row.instrument?.bondSchedule) {
      bondScheduleMap.set(
        row.instrument.bondSchedule.instrumentId,
        row.instrument.bondSchedule.rows as unknown as BondScheduleRow[]
      );
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
      instrumentType: r.instrument!.type,
      type: r.type as string,
      quantity: r.quantity.toString(),
      netAmount: r.netAmount.toString(),
      currencyCode: r.currencyCode,
      tradeDate: r.tradeDate.toISOString(),
    }));

  // Build v1 page data
  const v1Data = buildBondsPageData(trades, priceResult, cclMid);

  // Augment each holding with analytics and projected flows (v2)
  const cashflowEntries: BondCashflowEntry[] = [];
  const today = new Date();
  const holdingsV2: BondHoldingV2[] = v1Data.holdings.map((holding) => {
    const terms = bondTermsMap.get(holding.instrumentId);
    const storedSchedule = bondScheduleMap.get(holding.instrumentId);
    const hasTerms = !!terms;

    // AD-14 / T-51: BondSchedule (when present) is read directly — never
    // through projectCashFlows. A step-up bond (e.g. AL30) has no BondTerms
    // at all (refused by design, R-3c) and is display-only here: YTM/duration
    // for a schedule-only bond needs a schedule-aware solver, out of scope
    // for this wiring — it reports noTerms, exactly like today's "no terms"
    // case, while still showing the correct stored flows.
    if (storedSchedule && storedSchedule.length > 0) {
      const scheduleFlows = scheduleRowsToProjectedFlows(storedSchedule, today);
      const scaledFlows = terms
        ? scaleFlowsToHolding(scheduleFlows, holding.nominalHeld, "100")
        : scheduleFlows;

      if (terms) {
        cashflowEntries.push({ ticker: holding.ticker, currencyCode: terms.currencyCode, flows: scaledFlows });
      }

      const upcomingFlows: UpcomingFlow[] = scaledFlows.map((f) => ({
        date: f.date,
        flowType: f.flowType,
        amount: f.amount.toFixed(8).replace(/\.?0+$/, "") || "0",
        assumedRate: f.assumedRate,
        periodDays: f.periodDays,
      }));

      return {
        ...holding,
        analytics: {
          ytm: null,
          macaulayDuration: null,
          modifiedDuration: null,
          noConvergence: false,
          noTerms: !hasTerms,
          invalidPrice: false,
          matured: scaledFlows.length === 0,
        } satisfies BondAnalytics,
        projectedFlows: upcomingFlows,
        hasTerms,
        dayCountConvention: terms?.dayCountConvention ?? null,
      };
    }

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
        dayCountConvention: null,
      };
    }

    // Project cash flows — no stored schedule for this instrument, derive
    // via BondTerms (schedule-source.ts's fallback path).
    const projected = resolveBondSchedule(null, terms, today) as { source: "derived"; flows: ProjectedFlow[] };
    const projectedFlows = projected.flows;

    // Convert projected flows to CashFlow[] for analytics
    const cashFlowsForAnalytics: CashFlow[] = projectedFlows.map((f) => ({
      t: f.t,
      amount: f.amount,
    }));

    // Per-unit USD price for analytics.
    // projectCashFlows() emits cash flows scaled to one lámina (terms.faceValue).
    // marketValueUsd is the TOTAL position value = nominalHeld × per-unit price.
    // Dividing by nominalHeld gives the per-unit dirty price that matches the
    // per-unit cash-flow denomination, keeping YTM identical for 1 unit vs N units.
    let priceUsd: number | null = null;
    const nominalUnits = Number(holding.nominalHeld);
    if (holding.marketValueUsd !== null && nominalUnits > 0) {
      priceUsd = parseFloat(holding.marketValueUsd) / nominalUnits;
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

    // Display flows must reflect the actual position size, not the one-lámina
    // basis projectCashFlows() uses for YTM/duration — scale by nominalHeld.
    const scaledFlows = scaleFlowsToHolding(projectedFlows, holding.nominalHeld, terms.faceValue);
    cashflowEntries.push({
      ticker: holding.ticker,
      currencyCode: terms.currencyCode,
      flows: scaledFlows,
    });

    const upcomingFlows: UpcomingFlow[] = scaledFlows.map((f) => ({
      date: f.date,
      flowType: f.flowType,
      amount: f.amount.toFixed(8).replace(/\.?0+$/, "") || "0",
      assumedRate: f.assumedRate,
      periodDays: f.periodDays,
    }));

    return {
      ...holding,
      analytics,
      projectedFlows: upcomingFlows,
      hasTerms: true,
      dayCountConvention: terms.dayCountConvention,
    };
  });

  return {
    ...v1Data,
    holdings: holdingsV2,
    bondCashflowOutlook: buildBondCashflowOutlook(cashflowEntries, cclMid),
  };
}
