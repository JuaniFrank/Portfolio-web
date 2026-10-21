/**
 * Cash-flow aggregation and projection for ON (corporate bond) positions.
 *
 * v1: aggregateReceivedFlows, computeCouponsYtd
 * v2: projectCashFlows (requires BondTerms schema — additive, does not modify v1 exports)
 */

import Decimal from "decimal.js";
import type { ReceivedFlow } from "./types";
import type { CashFlow } from "./analytics";
import { isUsdCurrency } from "@/lib/rendimientos/cashflows";
import { normalizeConvention, periodAccrual } from "./day-count";

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

    if (isUsdCurrency(flow.currencyCode)) {
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
  /**
   * Accrual days in this coupon's period per the day-count convention
   * (actual days for ACT/*, 30-adjusted for 30/360). Null for AMORTIZATION flows.
   */
  periodDays: number | null;
};

/**
 * Project all future coupon and amortization cash flows from today through maturity.
 *
 * Rules:
 *  - Past flows (before `today`) are excluded.
 *  - FIXED: coupon amounts are deterministic from couponRate × remainingPrincipal / periodsPerYear.
 *  - FLOATING: projects at last-known couponRate; every coupon row is labeled assumedRate: true.
 *  - Each coupon accrues on the principal outstanding at the START of its period (split at
 *    any amortization inside the period). An amortization paid on a coupon date reduces the
 *    principal for the NEXT period, not for that coupon.
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
  const convention = normalizeConvention(terms.dayCountConvention);

  // Parse and sort amortization schedule (already sorted by parseAmortizationSchedule)
  const schedule = parseAmortizationSchedule(terms.amortizationSchedule);

  // Build ordered coupon payment dates from issueDate to maturityDate
  const couponDates = buildCouponDates(issueDate, maturityDate, freqMonths);

  // Coupons first: each accrues over its own period on the principal outstanding during
  // that period. An amortization paid ON a coupon date comes out of the principal only
  // after the period's interest has accrued, so it does not shrink that coupon.
  const flows: ProjectedFlow[] = [];

  let periodStart = issueDate;
  for (const couponDate of couponDates) {
    const eventTime = couponDate.getTime();
    const start = periodStart;
    periodStart = couponDate;
    if (eventTime <= todayTime) continue;

    // Interest accrues on principal at period start; an amortization strictly inside
    // the period splits it into sub-periods, each accruing on what was outstanding then.
    const boundaries = [
      start,
      ...schedule
        .map((entry) => new Date(entry.date))
        .filter((d) => d.getTime() > start.getTime() && d.getTime() < eventTime),
      couponDate,
    ];
    let couponAmount = new Decimal(0);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const from = boundaries[i]!;
      const principalPct = outstandingPctAt(schedule, from);
      if (principalPct.lte(0)) continue;
      const accrual = periodAccrual(from, boundaries[i + 1]!, convention);
      couponAmount = couponAmount.plus(
        couponRate
          .mul(faceValue.mul(principalPct.div(100)))
          .mul(new Decimal(accrual.yearFraction))
      );
    }
    if (couponAmount.lte(0)) continue;

    const fullPeriod = periodAccrual(start, couponDate, convention);
    flows.push({
      date: couponDate.toISOString(),
      flowType: "COUPON",
      amount: couponAmount.toDecimalPlaces(8).toNumber(),
      t: yearsBetween(today, couponDate),
      assumedRate: isFloating,
      periodDays: fullPeriod.days,
    });
  }

  for (const amort of schedule) {
    const amortDate = new Date(amort.date);
    if (amortDate.getTime() <= todayTime) continue;
    flows.push({
      date: amortDate.toISOString(),
      flowType: "AMORTIZATION",
      amount: faceValue.mul(new Decimal(amort.principalPct).div(100)).toDecimalPlaces(8).toNumber(),
      t: yearsBetween(today, amortDate),
      assumedRate: false,
      periodDays: null,
    });
  }

  // Sort all flows by date ascending (chronological order)
  flows.sort((a, b) => a.date.localeCompare(b.date));

  return flows;
}

/**
 * Scale projected flows (denominated in one lámina of `faceValue`) up to the
 * actual nominal quantity held.
 *
 * projectCashFlows() always computes amounts per one unit of terms.faceValue
 * — that per-unit basis is what YTM/duration need. Display of expected cash
 * flows, however, must reflect what the holder actually receives, which
 * scales linearly with how many nominal units they hold relative to that
 * single-lámina basis. Price paid (cost basis) is irrelevant here: coupon and
 * amortization amounts depend only on nominal units held, not on the price
 * paid for them.
 */
export function scaleFlowsToHolding(
  flows: ProjectedFlow[],
  nominalHeld: string | number,
  faceValue: string | number
): ProjectedFlow[] {
  const ratio = new Decimal(String(nominalHeld)).div(new Decimal(String(faceValue)));
  return flows.map((flow) => ({
    ...flow,
    amount: new Decimal(flow.amount).mul(ratio).toNumber(),
  }));
}

// ---------------------------------------------------------------------------
// v2 — Portfolio-wide cash-flow outlook (dashboard)
// ---------------------------------------------------------------------------

export type BondCashflowEntry = {
  ticker: string;
  /** BondTerms.currencyCode — "USD" or "ARS". */
  currencyCode: string;
  /** Future flows already scaled to the actual nominal held (scaleFlowsToHolding). */
  flows: ProjectedFlow[];
};

export type NextBondPayment = {
  /** ISO date (YYYY-MM-DD) of the nearest future payment across all holdings. */
  date: string;
  daysUntil: number;
  amountArs: string;
  amountUsd: string;
  /** Tickers paying on this date, alphabetically sorted. */
  tickers: string[];
};

export type BondCashflowOutlook = {
  nextPayment: NextBondPayment | null;
  currentYear: number;
  nextYear: number;
  projectedCurrentYearArs: string;
  projectedCurrentYearUsd: string;
  projectedNextYearArs: string;
  projectedNextYearUsd: string;
};

/**
 * Convert a native-currency flow amount to its ARS and USD equivalents.
 * When cclRate is unavailable, the foreign-currency side is left null rather
 * than guessed — matches the safe-skip convention used by computeCouponsYtd.
 *
 * Exported so other forward-looking cash-flow views (e.g. the dashboard's
 * "Próximos cobros" panel, `upcoming-income.ts`) can reuse the exact same
 * conversion instead of re-deriving it.
 */
export function toArsAndUsd(
  amount: number,
  currencyCode: string,
  cclRate: number | null
): { arsAmount: Decimal | null; usdAmount: Decimal | null } {
  if (currencyCode === "USD") {
    const usdAmount = new Decimal(amount);
    const arsAmount = cclRate && cclRate > 0 ? usdAmount.mul(cclRate) : null;
    return { arsAmount, usdAmount };
  }
  if (currencyCode === "ARS") {
    const arsAmount = new Decimal(amount);
    const usdAmount = cclRate && cclRate > 0 ? arsAmount.div(cclRate) : null;
    return { arsAmount, usdAmount };
  }
  return { arsAmount: null, usdAmount: null };
}

/**
 * Aggregate every holding's projected flows into a single portfolio-wide
 * outlook: the nearest upcoming payment (date, amount, which tickers) and the
 * total projected for the current and next calendar year.
 *
 * Flows must already be future-only (projectCashFlows guarantees this) and
 * scaled to the actual nominal held (scaleFlowsToHolding) — this function
 * only aggregates and converts currency, it does not filter or scale.
 */
export function buildBondCashflowOutlook(
  entries: BondCashflowEntry[],
  cclRate: number | null,
  today: Date = new Date()
): BondCashflowOutlook {
  const currentYear = today.getUTCFullYear();
  const nextYear = currentYear + 1;

  let currentYearArs = new Decimal(0);
  let currentYearUsd = new Decimal(0);
  let nextYearArs = new Decimal(0);
  let nextYearUsd = new Decimal(0);

  const byDate = new Map<
    string,
    { arsAmount: Decimal; usdAmount: Decimal; tickers: Set<string> }
  >();

  for (const entry of entries) {
    for (const flow of entry.flows) {
      const { arsAmount, usdAmount } = toArsAndUsd(flow.amount, entry.currencyCode, cclRate);
      const flowYear = new Date(flow.date).getUTCFullYear();

      if (flowYear === currentYear) {
        if (arsAmount) currentYearArs = currentYearArs.plus(arsAmount);
        if (usdAmount) currentYearUsd = currentYearUsd.plus(usdAmount);
      } else if (flowYear === nextYear) {
        if (arsAmount) nextYearArs = nextYearArs.plus(arsAmount);
        if (usdAmount) nextYearUsd = nextYearUsd.plus(usdAmount);
      }

      const dateKey = flow.date.slice(0, 10);
      const bucket = byDate.get(dateKey) ?? {
        arsAmount: new Decimal(0),
        usdAmount: new Decimal(0),
        tickers: new Set<string>(),
      };
      if (arsAmount) bucket.arsAmount = bucket.arsAmount.plus(arsAmount);
      if (usdAmount) bucket.usdAmount = bucket.usdAmount.plus(usdAmount);
      bucket.tickers.add(entry.ticker);
      byDate.set(dateKey, bucket);
    }
  }

  const nextDateKey = Array.from(byDate.keys()).sort()[0];
  let nextPayment: NextBondPayment | null = null;

  if (nextDateKey) {
    const bucket = byDate.get(nextDateKey)!;
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const daysUntil = Math.round(
      (new Date(`${nextDateKey}T00:00:00.000Z`).getTime() - todayUtc) / (24 * 60 * 60 * 1000)
    );
    nextPayment = {
      date: nextDateKey,
      daysUntil,
      amountArs: bucket.arsAmount.toFixed(2),
      amountUsd: bucket.usdAmount.toFixed(2),
      tickers: Array.from(bucket.tickers).sort(),
    };
  }

  return {
    nextPayment,
    currentYear,
    nextYear,
    projectedCurrentYearArs: currentYearArs.toFixed(2),
    projectedCurrentYearUsd: currentYearUsd.toFixed(2),
    projectedNextYearArs: nextYearArs.toFixed(2),
    projectedNextYearUsd: nextYearUsd.toFixed(2),
  };
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

/** Principal outstanding (0..100) once every amortization dated on or before `time` is paid. */
function outstandingPctAt(schedule: AmortizationEntry[], time: Date): Decimal {
  let remaining = new Decimal(100);
  for (const entry of schedule) {
    if (new Date(entry.date).getTime() <= time.getTime()) {
      remaining = remaining.minus(new Decimal(entry.principalPct));
    }
  }
  return remaining.lt(0) ? new Decimal(0) : remaining;
}

/**
 * Generate coupon payment dates from issueDate through maturityDate. Every date is
 * `issueDate + k × freqMonths` (not the previous date + freqMonths), so a short month
 * clamps that one date only: an issue on Jan 31 pays Feb 28, then Mar 31 — not Mar 28.
 */
export function buildCouponDates(
  issueDate: Date,
  maturityDate: Date,
  freqMonths: number
): Date[] {
  const dates: Date[] = [];
  if (freqMonths > 0) {
    for (let k = 1; ; k++) {
      const next = addMonthsUtc(issueDate, k * freqMonths);
      if (next.getTime() > maturityDate.getTime()) break;
      dates.push(next);
    }
  }

  // Always include maturityDate as the last coupon/amortization date if not already covered
  const lastDate = dates[dates.length - 1];
  if (!lastDate || lastDate.getTime() !== maturityDate.getTime()) {
    dates.push(new Date(maturityDate));
  }

  return dates;
}

/**
 * Add `months` to `date` in UTC, clamping to the last valid day when the target month is
 * shorter (Jan 31 + 1 month → Feb 28/29). UTC on purpose: date-fns works in the server's
 * local zone, which can shift a UTC-midnight date by a day.
 */
function addMonthsUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
}

/** Returns fractional years between two dates using ACT/365 convention. */
function yearsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}
