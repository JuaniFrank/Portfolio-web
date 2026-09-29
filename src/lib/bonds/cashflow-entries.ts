/**
 * Shared loader: portfolio-wide future ON cash flows, scaled to the actual
 * nominal held.
 *
 * Extracted from `getBondsPageDataAction` (src/app/actions/bonds.ts) so the
 * dashboard's "Próximos cobros" panel (`getUpcomingIncomeAction`) can reuse
 * the exact same holdings → schedule → scaled-flows pipeline instead of
 * re-deriving it — no duplication, `/bonds` behavior unchanged (this module
 * only isolates a self-contained piece of that action's logic; it does not
 * touch pricing, analytics, or display formatting, which stay in bonds.ts).
 */
import { prisma } from "@/lib/prisma";
import { TransactionType } from "@/lib/generated/prisma";
import { buildBondHoldings, type TradeForBondHoldings } from "./holdings";
import { resolveBondSchedule, type BondScheduleRow } from "./schedule-source";
import {
  scaleFlowsToHolding,
  type BondCashflowEntry,
  type BondTermsForProjection,
  type ProjectedFlow,
} from "./cashflows";

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Scope of ON transactions to load. Either every portfolio of a user
 * (`/bonds`, which aggregates across all of the user's portfolios) or a
 * fixed list of portfolio ids (the dashboard, which scopes to one). */
export type CashflowEntriesScope = { userId: string } | { portfolioIds: string[] };

/** AD-14: Docta's stored schedule has no COUPON/AMORTIZATION distinction of
 * its own (one row combines both) — split by whichever component of the row
 * is non-zero, matching the shape `projectCashFlows` already produces.
 * (Mirrors the private helper of the same name in `src/app/actions/bonds.ts`.) */
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

export async function loadBondCashflowEntries(
  scope: CashflowEntriesScope,
  today: Date = new Date()
): Promise<BondCashflowEntry[]> {
  if ("portfolioIds" in scope && scope.portfolioIds.length === 0) return [];

  const portfolioWhere = "userId" in scope ? { userId: scope.userId } : { id: { in: scope.portfolioIds } };

  const txRows = await prisma.transaction.findMany({
    where: {
      portfolio: portfolioWhere,
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
        select: { id: true, ticker: true, type: true, bondTerms: true, bondSchedule: true },
      },
    },
  });

  const bondTermsMap = new Map<string, BondTermsForProjection>();
  const bondScheduleMap = new Map<string, BondScheduleRow[]>();
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
    if (row.instrument?.bondSchedule) {
      bondScheduleMap.set(
        row.instrument.bondSchedule.instrumentId,
        row.instrument.bondSchedule.rows as unknown as BondScheduleRow[]
      );
    }
  }

  const trades: TradeForBondHoldings[] = txRows
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

  const rawHoldings = buildBondHoldings(trades.filter((t) => t.type === "BUY" || t.type === "SELL"));

  const entries: BondCashflowEntry[] = [];
  for (const holding of rawHoldings) {
    const terms = bondTermsMap.get(holding.instrumentId);
    const storedSchedule = bondScheduleMap.get(holding.instrumentId);

    if (storedSchedule && storedSchedule.length > 0) {
      if (!terms) continue;
      const scheduleFlows = scheduleRowsToProjectedFlows(storedSchedule, today);
      const scaledFlows = scaleFlowsToHolding(scheduleFlows, holding.nominalHeld, "100");
      entries.push({ ticker: holding.ticker, currencyCode: terms.currencyCode, flows: scaledFlows });
      continue;
    }

    if (!terms) continue;

    const projected = resolveBondSchedule(null, terms, today) as { source: "derived"; flows: ProjectedFlow[] };
    const scaledFlows = scaleFlowsToHolding(projected.flows, holding.nominalHeld, terms.faceValue);
    entries.push({ ticker: holding.ticker, currencyCode: terms.currencyCode, flows: scaledFlows });
  }

  return entries;
}
