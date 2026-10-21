/**
 * Outcome of the daily snapshot cron. **Pure module.**
 *
 * One portfolio failing must not hide the others: the run reports per-portfolio results and
 * the HTTP status says how bad it was (200 all good, 207 partial, 500 nothing worked).
 */

export type PortfolioRunResult =
  | { portfolioId: string; ok: true; priceIssueTickers: string[] }
  | { portfolioId: string; ok: false };

export type SnapshotRunSummary = {
  ok: boolean;
  status: 200 | 207 | 500;
  snapshotsCreated: number;
  failed: number;
  failedPortfolioIds: string[];
  /** Snapshots written with at least one position valued at cost or at a stale price. */
  portfoliosWithPriceIssues: Array<{ portfolioId: string; tickers: string[] }>;
};

export function summarizeSnapshotRun(results: readonly PortfolioRunResult[]): SnapshotRunSummary {
  const failedPortfolioIds: string[] = [];
  const portfoliosWithPriceIssues: SnapshotRunSummary["portfoliosWithPriceIssues"] = [];
  let snapshotsCreated = 0;

  for (const r of results) {
    if (!r.ok) {
      failedPortfolioIds.push(r.portfolioId);
      continue;
    }
    snapshotsCreated++;
    if (r.priceIssueTickers.length > 0) {
      portfoliosWithPriceIssues.push({ portfolioId: r.portfolioId, tickers: r.priceIssueTickers });
    }
  }

  const failed = failedPortfolioIds.length;
  const status = failed === 0 ? 200 : snapshotsCreated === 0 ? 500 : 207;
  return { ok: failed === 0, status, snapshotsCreated, failed, failedPortfolioIds, portfoliosWithPriceIssues };
}
