/**
 * Freshness of a cached spot quote. **Pure module.**
 *
 * The timestamp judged here is when the quote was FETCHED, not when the instrument last
 * traded: after the close or on weekends the last trade is hours or days old, so judging by
 * it would refetch Yahoo for every instrument on every render.
 */

/** A quote fetched less than 10 minutes ago is fresh. */
export const FRESH_PRICE_MS = 10 * 60 * 1000;

export function isQuoteFresh(fetchedAt: Date, nowMs: number, ttlMs: number = FRESH_PRICE_MS): boolean {
  return nowMs - fetchedAt.getTime() < ttlMs;
}
