import { describe, expect, it } from "vitest";
import { ALL_REPORTS_TAG, reportCacheBucket, reportTagsFor, userReportTag } from "./report-tags";

describe("report cache tags", () => {
  it("scopes the user tag by user id", () => {
    expect(userReportTag("u1")).toBe("reports:user:u1");
    expect(userReportTag("u1")).not.toBe(userReportTag("u2"));
  });

  it("tags every cached report with its user tag and the global tag", () => {
    expect(reportTagsFor("u1")).toEqual(["reports:user:u1", ALL_REPORTS_TAG]);
  });

  it("keeps tags within the 256 character limit", () => {
    expect(userReportTag("c".repeat(30)).length).toBeLessThan(256);
  });
});

describe("reportCacheBucket", () => {
  const FIVE_MIN_MS = 300_000;

  it("is stable within one window", () => {
    expect(reportCacheBucket(10 * FIVE_MIN_MS, 300)).toBe(reportCacheBucket(10 * FIVE_MIN_MS + 299_999, 300));
  });

  it("changes when the window rolls over, so an older entry is never read again", () => {
    expect(reportCacheBucket(10 * FIVE_MIN_MS + 300_000, 300)).not.toBe(reportCacheBucket(10 * FIVE_MIN_MS, 300));
  });

  it("is a string usable as a cache key part", () => {
    expect(reportCacheBucket(10 * FIVE_MIN_MS, 300)).toBe("10");
  });
});
