/**
 * Fixed-income analytics for ON (corporate bond) positions.
 *
 * Pure functions — no I/O, no external dependencies beyond decimal.js.
 *
 * Exported:
 *   computeYTM             — Yield to Maturity via Newton-Raphson → bisection
 *   computeMacaulayDuration
 *   computeModifiedDuration
 *   computeBondAnalytics   — convenience wrapper that handles all edge cases
 */

import Decimal from "decimal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CashFlow = {
  /** Years from valuation date to payment date (positive number). */
  t: number;
  /** Cash-flow amount in the same currency as the price. */
  amount: number;
};

export type YtmResult =
  | { ytm: number; noConvergence: false }
  | { ytm: null; noConvergence: true };

export type DurationResult = {
  macaulayDuration: number;
  modifiedDuration: number;
};

export type BondAnalyticsResult = {
  ytm: number | null;
  macaulayDuration: number | null;
  modifiedDuration: number | null;
  noConvergence: boolean;
  invalidPrice: boolean;
  matured: boolean;
  noTerms: boolean;
};

// ---------------------------------------------------------------------------
// YTM solver — Newton-Raphson with bisection fallback
// ---------------------------------------------------------------------------

const YTM_TOLERANCE = 1e-8;
const YTM_MAX_ITER = 100;
const YTM_BISECTION_LOW = 1e-6;
const YTM_BISECTION_HIGH = 2.0; // 200% — wide enough for distressed bonds

/**
 * Net Present Value of cash flows discounted at rate `r`.
 *
 * NPV(r) = Σ [ CF_i / (1 + r)^t_i ] - price
 */
function npv(cashFlows: CashFlow[], r: number, price: number): number {
  let pv = 0;
  for (const cf of cashFlows) {
    pv += cf.amount / Math.pow(1 + r, cf.t);
  }
  return pv - price;
}

/**
 * Derivative of NPV with respect to r.
 *
 * d/dr NPV(r) = -Σ [ t_i × CF_i / (1 + r)^(t_i + 1) ]
 */
function npvDerivative(cashFlows: CashFlow[], r: number): number {
  let d = 0;
  for (const cf of cashFlows) {
    d -= (cf.t * cf.amount) / Math.pow(1 + r, cf.t + 1);
  }
  return d;
}

/**
 * Compute Yield to Maturity via Newton-Raphson.
 *
 * Falls back to bisection when:
 *   - derivative is near zero (prevents division explosion), or
 *   - Newton step overshoots the valid range.
 *
 * Returns { ytm, noConvergence: false } on success,
 * or { ytm: null, noConvergence: true } when the solver cannot converge.
 *
 * @param cashFlows  - Future cash flows (t in years, amount in same unit as price)
 * @param price      - Current dirty price
 * @param seed       - Initial yield guess (defaults to 5% = 0.05)
 */
export function computeYTM(
  cashFlows: CashFlow[],
  price: number,
  seed = 0.05
): YtmResult {
  if (cashFlows.length === 0 || price <= 0) {
    return { ytm: null, noConvergence: true };
  }

  // Newton-Raphson phase
  let r = seed;

  for (let i = 0; i < YTM_MAX_ITER; i++) {
    const f = npv(cashFlows, r, price);
    const df = npvDerivative(cashFlows, r);

    if (Math.abs(f) < YTM_TOLERANCE) {
      // Converged
      return { ytm: r, noConvergence: false };
    }

    // If derivative is too small or would produce a negative rate, fall through to bisection
    if (Math.abs(df) < 1e-12 || !isFinite(df)) break;

    const rNext = r - f / df;

    // If the Newton step leaves the valid range, fall through to bisection
    if (rNext <= 0 || rNext > YTM_BISECTION_HIGH) break;

    r = rNext;
  }

  // Bisection fallback — guaranteed to converge if solution is in [low, high]
  let lo = YTM_BISECTION_LOW;
  let hi = YTM_BISECTION_HIGH;

  const fLo = npv(cashFlows, lo, price);
  const fHi = npv(cashFlows, hi, price);

  // If no sign change, there is no solution in the bracket
  if (fLo * fHi > 0) {
    return { ytm: null, noConvergence: true };
  }

  for (let i = 0; i < YTM_MAX_ITER; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(cashFlows, mid, price);

    if (Math.abs(fMid) < YTM_TOLERANCE || (hi - lo) / 2 < YTM_TOLERANCE) {
      return { ytm: mid, noConvergence: false };
    }

    if (fLo * fMid < 0) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  return { ytm: null, noConvergence: true };
}

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/**
 * Compute Macaulay Duration and Modified Duration.
 *
 * Macaulay Duration = Σ[ t_i × PV(CF_i) ] / Price
 * Modified Duration = Macaulay Duration / (1 + ytm / periodsPerYear)
 *
 * @param cashFlows     - Future cash flows
 * @param ytm           - Yield to maturity (annual, as decimal e.g. 0.08)
 * @param price         - Current dirty price (used as denominator)
 * @param periodsPerYear - Coupon periods per year (e.g. 2 for semi-annual)
 */
export function computeMacaulayDuration(
  cashFlows: CashFlow[],
  ytm: number,
  price: number,
  periodsPerYear: number
): DurationResult | null {
  if (cashFlows.length === 0 || price <= 0 || ytm < 0) return null;

  let weightedSum = new Decimal(0);
  let pvSum = new Decimal(0);

  for (const cf of cashFlows) {
    const pv = new Decimal(cf.amount).div(
      new Decimal(1 + ytm).pow(new Decimal(cf.t))
    );
    weightedSum = weightedSum.plus(pv.mul(new Decimal(cf.t)));
    pvSum = pvSum.plus(pv);
  }

  if (pvSum.isZero()) return null;

  const macaulay = weightedSum.div(new Decimal(price)).toNumber();
  const modified = macaulay / (1 + ytm / periodsPerYear);

  return { macaulayDuration: macaulay, modifiedDuration: modified };
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Top-level analytics wrapper.
 *
 * Handles all edge cases documented in the spec and returns a fully typed
 * BondAnalyticsResult. Call this from server actions — do not call the
 * lower-level functions directly unless writing unit tests.
 *
 * @param cashFlows      - Projected future cash flows (empty = matured or no terms)
 * @param price          - Current market price in USD (null = unavailable)
 * @param periodsPerYear - Coupon periods per year (12 / couponFrequencyMonths)
 * @param hasTerms       - Whether BondTerms exist for this instrument
 */
export function computeBondAnalytics(
  cashFlows: CashFlow[],
  price: number | null,
  periodsPerYear: number,
  hasTerms: boolean
): BondAnalyticsResult {
  const base: BondAnalyticsResult = {
    ytm: null,
    macaulayDuration: null,
    modifiedDuration: null,
    noConvergence: false,
    invalidPrice: false,
    matured: false,
    noTerms: false,
  };

  if (!hasTerms) {
    return { ...base, noTerms: true };
  }

  if (price === null) {
    // Price unavailable — degrade gracefully
    return base;
  }

  if (price <= 0) {
    return { ...base, invalidPrice: true };
  }

  if (cashFlows.length === 0) {
    return { ...base, matured: true };
  }

  const ytmResult = computeYTM(cashFlows, price);

  if (ytmResult.noConvergence) {
    return { ...base, noConvergence: true };
  }

  const ytm = ytmResult.ytm!;
  const durationResult = computeMacaulayDuration(cashFlows, ytm, price, periodsPerYear);

  return {
    ytm,
    macaulayDuration: durationResult?.macaulayDuration ?? null,
    modifiedDuration: durationResult?.modifiedDuration ?? null,
    noConvergence: false,
    invalidPrice: false,
    matured: false,
    noTerms: false,
  };
}
