/**
 * Type definitions for the bonds (ON — Obligaciones Negociables) domain.
 *
 * Slice v1: BondHolding, ReceivedFlow, BondKpis, BondsPageData
 * Slice v2 stubs: UpcomingFlow, BondAnalytics (no logic yet, schema-free)
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
// v2 type stubs (no logic yet — requires BondTerms schema)
// ---------------------------------------------------------------------------

// v2: UpcomingFlow — projected future coupon/amortization payment
// export type UpcomingFlow = { ... };

// v2: BondAnalytics — YTM, Macaulay Duration, Modified Duration
// export type BondAnalytics = { ... };
