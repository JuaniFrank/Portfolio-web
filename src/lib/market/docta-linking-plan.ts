/**
 * Pure ordering + budget arithmetic for AD-13's fixed-income ISIN linking.
 *
 * MEASURED (2026-09-16, against the live Docta service): the "basic" plan's
 * real ceiling is **15 requests per day** (`x-dailylimit-limit: 15`) and
 * **10 requests per minute** (`x-ratelimit-limit: 10`) — not the "essentially
 * free" whole-universe assumption an earlier briefing carried into the
 * design. Linking all 221 fixed-income tickers in one run is impossible
 * under this budget; this module decides WHO gets a live lookup this run.
 *
 * Held instruments (referenced by at least one `Transaction`) go first, so a
 * user holding a handful of bonds gets them linked the same day the quota
 * allows it. Everything else fills in over subsequent runs — deliberately:
 * an unlinked fixed-income row is still fully searchable and tradable
 * (FR-3), so deferring it costs nothing but a settlement chip for a few days.
 */

export type FixedIncomeCandidate = {
  ticker: string;
  /** False when this ticker already has a permanently-resolved Docta answer
   * — either a populated `isin` or a cached definitive 404 — so a live
   * lookup would be pointless. This is what makes repeated runs advance:
   * once resolved, a ticker never re-enters the plan. */
  needsDoctaLookup: boolean;
  isHeld: boolean;
};

/**
 * Orders unresolved candidates held-first (stable within each group) and
 * slices to `budget` live lookups for this run. A negative budget is
 * clamped to 0 rather than throwing or returning everything.
 */
export function planDoctaLinkingBatch(
  candidates: FixedIncomeCandidate[],
  budget: number
): FixedIncomeCandidate[] {
  const safeBudget = Math.max(0, budget);
  if (safeBudget === 0) return [];

  const unresolved = candidates.filter((c) => c.needsDoctaLookup);
  const held = unresolved.filter((c) => c.isHeld);
  const unheld = unresolved.filter((c) => !c.isHeld);

  return [...held, ...unheld].slice(0, safeBudget);
}
