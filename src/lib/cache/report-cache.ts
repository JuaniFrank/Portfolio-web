import { unstable_cache, updateTag } from "next/cache";
import { loadPortfolioEvolution } from "@/lib/dashboard/evolution-data";
import type { PortfolioEvolution } from "@/lib/dashboard/evolution";
import { buildPerformanceReport } from "@/lib/rendimientos/series";
import type { PerformanceReport } from "@/lib/rendimientos/types";
import { ALL_REPORTS_TAG, reportTagsFor, userReportTag } from "./report-tags";

/**
 * Per-user cache for the heavy /rendimientos computations.
 *
 * `unstable_cache` (not `use cache`): `use cache` needs `cacheComponents`, which makes every
 * request-time read in the app (session, Prisma) require a Suspense boundary. The older API
 * is the documented option for apps without it, and fits here because the cached functions
 * take explicit arguments only (no cookies/headers inside).
 *
 * Both results are plain JSON (strings/numbers/null, no Decimal or Date), so the JSON
 * round-trip the cache performs is lossless. A throwing loader is never cached.
 */
const REPORT_REVALIDATE_SECONDS = 300;

export function getCachedPerformanceReport(
  userId: string,
  portfolioId: string,
  portfolioName: string
): Promise<PerformanceReport> {
  return unstable_cache(
    () => buildPerformanceReport({ portfolioIds: [portfolioId], portfolioName }),
    ["rendimientos-report", userId, portfolioId, portfolioName],
    { revalidate: REPORT_REVALIDATE_SECONDS, tags: reportTagsFor(userId) }
  )();
}

export function getCachedPortfolioEvolution(
  userId: string,
  portfolioId: string
): Promise<PortfolioEvolution> {
  return unstable_cache(
    () => loadPortfolioEvolution([portfolioId]),
    ["rendimientos-evolution", userId, portfolioId],
    { revalidate: REPORT_REVALIDATE_SECONDS, tags: reportTagsFor(userId) }
  )();
}

/**
 * Expire one user's cached reports right away (read-your-own-writes). Server Actions only.
 * Call it from every mutation of that user's transactions.
 */
export function invalidateUserReports(userId: string): void {
  updateTag(userReportTag(userId));
}

/**
 * Expire every user's cached reports. For data shared across users and keyed by
 * instrument (corporate events, bond terms). Server Actions only.
 */
export function invalidateAllReports(): void {
  updateTag(ALL_REPORTS_TAG);
}
