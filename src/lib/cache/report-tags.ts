/**
 * Cache tags for the heavy per-user reports (/rendimientos). **Pure module.**
 *
 * Every cached report carries the user tag (invalidated when that user's transactions
 * change) and a global tag (invalidated by data shared across users, such as corporate
 * events and bond terms, which are keyed by instrument and not by user).
 */

export const ALL_REPORTS_TAG = "reports:all";

export function userReportTag(userId: string): string {
  return `reports:user:${userId}`;
}

export function reportTagsFor(userId: string): string[] {
  return [userReportTag(userId), ALL_REPORTS_TAG];
}

/**
 * Time window of a cached report, as a cache key part. `unstable_cache` serves an expired
 * entry while it revalidates in the background (stale-while-revalidate), so after an idle
 * period the first visit would get the previous visit's report — prices included, possibly
 * from the day before. Keying by window makes the TTL hard: an entry from an earlier window
 * is never read again and the first visit of a new window computes a fresh report.
 */
export function reportCacheBucket(nowMs: number, windowSeconds: number): string {
  return String(Math.floor(nowMs / (windowSeconds * 1000)));
}
