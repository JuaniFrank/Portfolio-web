import { describe, expect, it } from "vitest";
import { summarizeSnapshotRun, type PortfolioRunResult } from "./cron-summary";

const ok = (portfolioId: string, issueTickers: string[] = []): PortfolioRunResult => ({
  portfolioId,
  ok: true,
  priceIssueTickers: issueTickers,
});
const failed = (portfolioId: string): PortfolioRunResult => ({ portfolioId, ok: false });

describe("summarizeSnapshotRun", () => {
  it("is a plain 200 when everything succeeds", () => {
    expect(summarizeSnapshotRun([ok("a"), ok("b")])).toEqual({
      ok: true,
      status: 200,
      snapshotsCreated: 2,
      failed: 0,
      failedPortfolioIds: [],
      portfoliosWithPriceIssues: [],
    });
  });

  it("is a 200 for an empty run", () => {
    expect(summarizeSnapshotRun([]).status).toBe(200);
  });

  it("reports a partial failure as 207 with the failed ids", () => {
    const summary = summarizeSnapshotRun([ok("a"), failed("b"), ok("c")]);
    expect(summary).toMatchObject({
      ok: false,
      status: 207,
      snapshotsCreated: 2,
      failed: 1,
      failedPortfolioIds: ["b"],
    });
  });

  it("is a 500 when every portfolio failed", () => {
    const summary = summarizeSnapshotRun([failed("a"), failed("b")]);
    expect(summary.status).toBe(500);
    expect(summary.failedPortfolioIds).toEqual(["a", "b"]);
  });

  it("flags portfolios valued with missing prices without failing the run", () => {
    const summary = summarizeSnapshotRun([ok("a", ["GGAL"]), ok("b")]);
    expect(summary.status).toBe(200);
    expect(summary.portfoliosWithPriceIssues).toEqual([{ portfolioId: "a", tickers: ["GGAL"] }]);
  });
});
