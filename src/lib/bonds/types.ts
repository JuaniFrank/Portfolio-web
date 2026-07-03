/**
 * Type definitions for the bonds (ON — Obligaciones Negociables) domain.
 *
 * Slice v1: BondHolding, ReceivedFlow, BondKpis, BondsPageData
 * Slice v2: UpcomingFlow, BondAnalytics, BondTermsSummary (analytics + projection)
 */

// ---------------------------------------------------------------------------
// v1 types
// ---------------------------------------------------------------------------

export type BondHolding = {
  ticker: string;
  instrumentId: string;
  /** Net nominal units held: SUM(BUY qty) - SUM(SELL qty). */
  nominalHeld: string;
  /** Cost basis in USD (native currency for ON trades). */
  costBasisUsd: string;
  /** Market value in ARS: nominalHeld × (data912.c / 100). Null when price unavailable. */
  marketValueArs: string | null;
  /** Market value in USD: marketValueArs / cclMid. Null when price or CCL unavailable. */
  marketValueUsd: string | null;
  /** Unrealized P&L in USD: marketValueUsd - costBasisUsd. Null when market value unavailable. */
  unrealizedPnlUsd: string | null;
  /** Percent change relative to cost basis. Null when market value unavailable. */
  pctChange: string | null;
  /**
   * True when the price comes from PriceCache (data912 fetch failed).
   * The UI should render a staleness badge.
   */
  priceStale: boolean;
  /**
   * True when no price is available at all (data912 failed AND no cache entry).
   * The UI renders "price unavailable" instead of market value fields.
   */
  priceUnavailable: boolean;
  /**
   * Last price from data912 in ARS per 100 nominal VN.
   * Null when price is unavailable.
   * Carried directly from data912 `c` field to avoid back-calculating from marketValueArs.
   */
  lastPriceArs: string | null;
};

export type ReceivedFlow = {
  ticker: string;
  /** COUPON or AMORTIZATION */
  type: "COUPON" | "AMORTIZATION";
  /** ISO date string (tradeDate). */
  date: string;
  /** Amount in native transaction currency. */
  amount: string;
  currencyCode: string;
};

export type BondKpis = {
  /** Sum of all marketValueUsd across holdings. Null if no prices available. */
  totalMarketValueUsd: string | null;
  /** Sum of all marketValueArs across holdings. Null if no prices available. */
  totalMarketValueArs: string | null;
  /** Sum of COUPON amounts in the current calendar year, in USD. */
  couponsYtdUsd: string;
};

export type BondsPageData = {
  holdings: BondHolding[];
  flows: ReceivedFlow[];
  kpis: BondKpis;
  /** CCL mid rate used for ARS→USD conversion. Null if dolarapi failed. */
  cclMid: string | null;
  /** True if any holding price comes from stale cache. */
  anyPriceStale: boolean;
};

// ---------------------------------------------------------------------------
// v2 types — analytics + forward projection (requires BondTerms schema)
// ---------------------------------------------------------------------------

/** A projected future cash-flow event (coupon or amortization). */
export type UpcomingFlow = {
  /** ISO date string of the payment. */
  date: string;
  /** "COUPON" or "AMORTIZATION" */
  flowType: "COUPON" | "AMORTIZATION";
  /** Amount in BondTerms currency. */
  amount: string;
  /** True when rateType is FLOATING — rate is the last-known value, not a forecast. */
  assumedRate: boolean;
  /**
   * Accrual days in this coupon's period per the day-count convention.
   * Null for AMORTIZATION flows (no accrual period).
   */
  periodDays: number | null;
};

/** YTM and duration analytics for a single position. */
export type BondAnalytics = {
  /** Yield to maturity as a decimal (e.g. 0.082 = 8.2%). Null when unavailable. */
  ytm: number | null;
  /** Macaulay duration in years. Null when unavailable. */
  macaulayDuration: number | null;
  /** Modified duration. Null when unavailable. */
  modifiedDuration: number | null;
  /** True when the YTM solver did not converge. */
  noConvergence: boolean;
  /** True when no BondTerms have been entered for this instrument. */
  noTerms: boolean;
  /** True when the market price is zero or negative. */
  invalidPrice: boolean;
  /** True when the bond has matured (no future cash flows). */
  matured: boolean;
};

/** Augments BondHolding for the v2 bonds page. */
export type BondHoldingV2 = BondHolding & {
  /** Analytics result. Null fields when BondTerms are missing or price unavailable. */
  analytics: BondAnalytics | null;
  /** Forward projected cash flows. Empty array when no BondTerms or bond matured. */
  projectedFlows: UpcomingFlow[];
  /** True when BondTerms exist for this instrument. */
  hasTerms: boolean;
  /**
   * Day-count convention from BondTerms (e.g. "ACT/365"), shown as the unit of
   * the "días del período" column. Null when no terms are entered.
   */
  dayCountConvention: string | null;
};

export type BondsPageDataV2 = Omit<BondsPageData, "holdings"> & {
  holdings: BondHoldingV2[];
};
