/**
 * Cash-flow aggregation for ON (corporate bond) positions.
 *
 * v1: aggregateReceivedFlows, computeCouponsYtd
 * v2 stub: projectCashFlows (requires BondTerms schema)
 */

import Decimal from "decimal.js";
import type { ReceivedFlow } from "./types";

export type TransactionForCashFlows = {
  ticker: string;
  type: string;
  tradeDate: Date | string;
  netAmount: string;
  currencyCode: string;
};

/**
 * Aggregate all received COUPON and AMORTIZATION transactions into ReceivedFlow records,
 * ordered by date descending.
 */
export function aggregateReceivedFlows(
  transactions: TransactionForCashFlows[]
): ReceivedFlow[] {
  const flows: ReceivedFlow[] = transactions
    .filter((t) => t.type === "COUPON" || t.type === "AMORTIZATION")
    .map((t) => ({
      ticker: t.ticker,
      type: t.type as "COUPON" | "AMORTIZATION",
      date:
        t.tradeDate instanceof Date
          ? t.tradeDate.toISOString()
          : new Date(t.tradeDate).toISOString(),
      amount: new Decimal(t.netAmount).abs().toFixed(2),
      currencyCode: t.currencyCode,
    }));

  // Order by date descending (most recent first)
  flows.sort((a, b) => b.date.localeCompare(a.date));

  return flows;
}

/**
 * Compute the total coupon income received in the current calendar year, in USD.
 *
 * ARS-denominated coupon amounts are converted to USD at the provided cclRate.
 * Only COUPON type flows from the current UTC calendar year are included.
 */
export function computeCouponsYtd(flows: ReceivedFlow[], cclRate: number): string {
  const currentYear = new Date().getUTCFullYear();

  let total = new Decimal(0);

  for (const flow of flows) {
    if (flow.type !== "COUPON") continue;

    const flowYear = new Date(flow.date).getUTCFullYear();
    if (flowYear !== currentYear) continue;

    const amount = new Decimal(flow.amount);

    if (flow.currencyCode === "USD") {
      total = total.plus(amount);
    } else if (flow.currencyCode === "ARS" && cclRate > 0) {
      total = total.plus(amount.div(new Decimal(cclRate)));
    }
    // Unknown currency: skip (safe fallback)
  }

  return total.toFixed(2);
}

// v2: projectCashFlows(terms: BondTerms, today: Date): ProjectedFlow[]
// Requires BondTerms schema (Slice v2). Stub kept for reference.
