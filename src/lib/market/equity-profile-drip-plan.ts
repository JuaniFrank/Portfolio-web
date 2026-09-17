/**
 * Pure candidate selection for the equity-profile drip (arg_stocks/
 * arg_cedears profile enrichment — see `yahoo-catalog.ts`'s
 * `enrichUnusedEquityProfiles`). Scoped only to STOCK_AR/CEDEAR profile
 * fields (name/sector/industry/website) — never price data, never bonds.
 *
 * Deterministic alphabetical ordering (not insertion order) so repeated
 * runs make steady, predictable progress through the ~1,687-symbol
 * universe rather than depending on incidental query order.
 */

export type EquityProfileCandidate = {
  ticker: string;
  /** Already covered by `enrichUsedInstruments` this same run (a held
   * instrument) — re-fetching it here would be a wasted duplicate call. */
  isHeld: boolean;
};

export function planEquityProfileDrip(
  candidates: EquityProfileCandidate[],
  limit: number
): EquityProfileCandidate[] {
  const safeLimit = Math.max(0, limit);
  if (safeLimit === 0) return [];

  return candidates
    .filter((c) => !c.isHeld)
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
    .slice(0, safeLimit);
}
