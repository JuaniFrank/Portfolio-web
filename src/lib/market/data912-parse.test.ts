import { describe, expect, it } from "vitest";
import { parseLiveOnQuote, parseCachedClose } from "./data912-parse";

describe("parseLiveOnQuote", () => {
  it("builds a quote from a valid item", () => {
    expect(parseLiveOnQuote({ c: 155000, px_bid: 154000, px_ask: 156000, pct_change: 1.5 }, "MCC3O")).toEqual({
      symbol: "MCC3O",
      c: 155000,
      px_bid: 154000,
      px_ask: 156000,
      pct_change: 1.5,
    });
  });

  it("falls back bid/ask to c and pct_change to 0", () => {
    const q = parseLiveOnQuote({ c: 100 }, "X");
    expect(q).toMatchObject({ px_bid: 100, px_ask: 100, pct_change: 0 });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "100", null, undefined])(
    "rejects c = %s (a zero close means no data, not a price)",
    (c) => {
      expect(parseLiveOnQuote({ c }, "X")).toBeNull();
    }
  );

  it("rejects a missing item", () => {
    expect(parseLiveOnQuote(undefined, "X")).toBeNull();
  });
});

describe("parseCachedClose", () => {
  it("accepts a positive finite close", () => {
    expect(parseCachedClose(1550.5)).toBe(1550.5);
  });

  it.each([0, -3, Number.NaN])("rejects %s", (n) => {
    expect(parseCachedClose(n)).toBeNull();
  });
});
