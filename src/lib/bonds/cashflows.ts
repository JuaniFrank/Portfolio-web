/**
 * Cash-flow aggregation and projection for ON (corporate bond) positions.
 *
 * v1: aggregateReceivedFlows, computeCouponsYtd
 * v2: projectCashFlows (requires BondTerms schema — additive, does not modify v1 exports)
 */

import Decimal from "decimal.js";
import type { ReceivedFlow } from "./types";
import type { CashFlow } from "./analytics";

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

// ---------------------------------------------------------------------------
// v2 — Forward Cash-Flow Projection
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a BondTerms record needed for projection.
 * Matches the Prisma-generated BondTerms type (using string/number primitives
 * to keep this module free of Prisma runtime imports).
 */
export type BondTermsForProjection = {
  faceValue: string | number;
  currencyCode: string;
  rateType: "FIXED" | "FLOATING";
  couponRate: string | number;
  couponFrequencyMonths: number;
  issueDate: Date | string;
  maturityDate: Date | string;
  /**
   * JSON array of { date: string (ISO date), principalPct: number }.
   * principalPct values should sum to 100.
   */
  amortizationSchedule: unknown;
  dayCountConvention: string;
};

export type AmortizationEntry = {
  date: string; // ISO date string
  principalPct: number;
};

export type ProjectedFlow = CashFlow & {
  /** ISO date string of the payment. */
  date: string;
  /** "COUPON" or "AMORTIZATION" */
  flowType: "COUPON" | "AMORTIZATION";
  /** True when rateType is FLOATING — rate is the last-known value, not a forecast. */
  assumedRate: boolean;
};

/**
 * Project all future coupon and amortization cash flows from today through maturity.
 *
 * Rules:
 *  - Past flows (before `today`) are excluded.
 *  - FIXED: coupon amounts are deterministic from couponRate × remainingPrincipal / periodsPerYear.
 *  - FLOATING: projects at last-known couponRate; every coupon row is labeled assumedRate: true.
 *  - Amortization events reduce the outstanding principal; subsequent coupons apply to the
 *    reduced principal.
 *  - Returns an empty array for a matured bond (maturityDate < today).
 *
 * @param terms  - BondTerms record (from Prisma or equivalent)
 * @param today  - Reference date (defaults to current UTC day)
 */
export function projectCashFlows(
  terms: BondTermsForProjection,
  today: Date = new Date()
): ProjectedFlow[] {
  const maturityDate = new Date(terms.maturityDate);
  const todayTime = today.getTime();

  // Already matured — no future flows
  if (maturityDate.getTime() <= todayTime) return [];

  const issueDate = new Date(terms.issueDate);
  const faceValue = new Decimal(String(terms.faceValue));
  const couponRate = new Decimal(String(terms.couponRate));
  const freqMonths = terms.couponFrequencyMonths;
  const isFloating = terms.rateType === "FLOATING";

  // Parse and sort amortization schedule
  const schedule = parseAmortizationSchedule(terms.amortizationSchedule);

  // Build ordered coupon payment dates from issueDate to maturityDate
  const couponDates = buildCouponDates(issueDate, maturityDate, freqMonths);

  // Track remaining principal (as percentage 0..100)
  let remainingPrincipalPct = new Decimal(100);

  const flows: ProjectedFlow[] = [];

  for (const couponDate of couponDates) {
    const couponTime = couponDate.getTime();

    // Apply any amortization events that occur ON this coupon date or before it
    // (Amortization reduces the principal before computing the coupon on the same date)
    for (const amort of schedule) {
      const amortTime = new Date(amort.date).getTime();
      if (amortTime === couponTime) {
        const principalAmount = faceValue.mul(new Decimal(amort.principalPct).div(100));
        const t = yearsBetween(today, couponDate);

        if (couponTime > todayTime) {
          flows.push({
            date: couponDate.toISOString(),
            flowType: "AMORTIZATION",
            amount: principalAmount.toDecimalPlaces(8).toNumber(),
            t,
            assumedRate: false,
          });
        }
        remainingPrincipalPct = remainingPrincipalPct.minus(new Decimal(amort.principalPct));
        if (remainingPrincipalPct.lt(0)) remainingPrincipalPct = new Decimal(0);
      }
    }

    // Coupon: rate × remainingPrincipal / (12 / freqMonths)
    if (couponTime > todayTime && remainingPrincipalPct.gt(0)) {
      const periodsPerYear = new Decimal(12).div(new Decimal(freqMonths));
      const outstandingPrincipal = faceValue.mul(remainingPrincipalPct.div(100));
      const couponAmount = couponRate.mul(outstandingPrincipal).div(periodsPerYear);
      const t = yearsBetween(today, couponDate);

      flows.push({
        date: couponDate.toISOString(),
        flowType: "COUPON",
        amount: couponAmount.toDecimalPlaces(8).toNumber(),
        t,
        assumedRate: isFloating,
      });
    }
  }

  // Handle amortization entries that don't coincide with a coupon date
  // (e.g. bullet maturity amortization on maturityDate itself)
  const couponDateSet = new Set(couponDates.map((d) => d.getTime()));

  for (const amort of schedule) {
    const amortDate = new Date(amort.date);
    const amortTime = amortDate.getTime();

    // Only process non-coupon-date amortizations that are in the future
    if (!couponDateSet.has(amortTime) && amortTime > todayTime) {
      const principalAmount = faceValue.mul(new Decimal(amort.principalPct).div(100));
      const t = yearsBetween(today, amortDate);

      flows.push({
        date: amortDate.toISOString(),
        flowType: "AMORTIZATION",
        amount: principalAmount.toDecimalPlaces(8).toNumber(),
        t,
        assumedRate: false,
      });
    }
  }

  // Sort all flows by date ascending (chronological order)
  flows.sort((a, b) => a.date.localeCompare(b.date));

  return flows;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseAmortizationSchedule(raw: unknown): AmortizationEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is AmortizationEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as AmortizationEntry).date === "string" &&
        typeof (entry as AmortizationEntry).principalPct === "number"
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Generate coupon payment dates from issueDate through maturityDate,
 * stepping by freqMonths each time.
 */
function buildCouponDates(
  issueDate: Date,
  maturityDate: Date,
  freqMonths: number
): Date[] {
  const dates: Date[] = [];
  let current = addMonths(issueDate, freqMonths);

  while (current.getTime() <= maturityDate.getTime()) {
    dates.push(new Date(current));
    current = addMonths(current, freqMonths);
  }

  // Always include maturityDate as the last coupon/amortization date if not already covered
  const lastDate = dates[dates.length - 1];
  if (!lastDate || lastDate.getTime() !== maturityDate.getTime()) {
    dates.push(new Date(maturityDate));
  }

  return dates;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/** Returns fractional years between two dates using ACT/365 convention. */
function yearsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}
