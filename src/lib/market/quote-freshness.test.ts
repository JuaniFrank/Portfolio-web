import { describe, expect, it } from "vitest";
import { FRESH_PRICE_MS, isQuoteFresh } from "./quote-freshness";

const NOW = Date.parse("2026-10-17T15:00:00Z"); // a Saturday: the market is closed

describe("isQuoteFresh", () => {
  it("is fresh when fetched less than the TTL ago", () => {
    expect(isQuoteFresh(new Date(NOW - FRESH_PRICE_MS + 1), NOW)).toBe(true);
  });

  it("is stale from the TTL onwards", () => {
    expect(isQuoteFresh(new Date(NOW - FRESH_PRICE_MS), NOW)).toBe(false);
    expect(isQuoteFresh(new Date(NOW - 24 * 60 * 60 * 1000), NOW)).toBe(false);
  });

  it("treats a timestamp slightly in the future (clock skew) as fresh", () => {
    expect(isQuoteFresh(new Date(NOW + 1000), NOW)).toBe(true);
  });

  it("judges by fetch time: a just-fetched weekend quote stays fresh even though its last trade was Friday", () => {
    const fetchedAt = new Date(NOW - 60 * 1000);
    expect(isQuoteFresh(fetchedAt, NOW)).toBe(true);
  });
});
