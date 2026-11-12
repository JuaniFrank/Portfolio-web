import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYahooQuote, parseYahooHistory } from "./yahoo";

// Shape of Yahoo's v8 chart response for SPY on 2026-11-05 after the close: today's bar comes
// with open/high/low/volume but `close: null` until Yahoo consolidates it; the last trade is
// only in `meta.regularMarketPrice`.
const NOV_4_OPEN = 1793802600; // 2026-11-04T14:30:00Z
const NOV_5_OPEN = 1793889000; // 2026-11-05T14:30:00Z
const NOV_5_CLOSE = 1793912400; // 2026-11-05T21:00:00Z

function body(overrides: {
  close?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  meta?: Record<string, number | string>;
}) {
  return {
    chart: {
      result: [
        {
          meta: {
            currency: "USD",
            regularMarketPrice: 733,
            regularMarketTime: NOV_5_CLOSE,
            regularMarketDayHigh: 765.97,
            regularMarketDayLow: 732.71,
            ...overrides.meta,
          },
          timestamp: [NOV_4_OPEN, NOV_5_OPEN],
          indicators: {
            quote: [
              {
                open: [762.99, 765.47],
                high: overrides.high ?? [775.64, 765.97],
                low: overrides.low ?? [762.64, 732.71],
                close: overrides.close ?? [766.81, null],
                volume: [62126400, 120886017],
              },
            ],
          },
        },
      ],
      error: null,
    },
  };
}

describe("parseYahooHistory", () => {
  it("keeps today's bar using the last trade when Yahoo has not consolidated its close", () => {
    const { bars } = parseYahooHistory("SPY", body({}));

    expect(bars.map((b) => b.date.toISOString().slice(0, 10))).toEqual(["2026-11-04", "2026-11-05"]);
    expect(bars[1]).toMatchObject({ open: 765.47, high: 765.97, low: 732.71, close: 733, volume: 120886017 });
  });

  it("fills a missing high/low of today's bar from the day range", () => {
    const { bars } = parseYahooHistory("SPY", body({ high: [775.64, null], low: [762.64, null] }));

    expect(bars[1]).toMatchObject({ high: 765.97, low: 732.71, close: 733 });
  });

  it("drops a null-close bar whose day is not the last trade's day", () => {
    // Last trade is from Nov 4: the Nov 5 bar has no price to stand on.
    const { bars } = parseYahooHistory(
      "SPY",
      body({ meta: { regularMarketTime: NOV_4_OPEN + 3600 } })
    );

    expect(bars.map((b) => b.date.toISOString().slice(0, 10))).toEqual(["2026-11-04"]);
  });

  it("drops a null-close bar when there is no usable last trade", () => {
    const { bars } = parseYahooHistory("SPY", body({ meta: { regularMarketPrice: 0 } }));

    expect(bars).toHaveLength(1);
  });

  it("never overrides a consolidated close", () => {
    const { bars } = parseYahooHistory("SPY", body({ close: [766.81, 734.5] }));

    expect(bars[1]!.close).toBe(734.5);
  });

  it("reads the currency", () => {
    expect(parseYahooHistory("SPY", body({})).currency).toBe("USD");
  });
});

describe("fetchYahooQuote cache policy", () => {
  function stubFetch() {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push({ ...init });
        return new Response(
          JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 201.5, currency: "USD" } }] } }),
          { status: 200 }
        );
      })
    );
    return calls;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("bypasses the data cache when fresh is requested", async () => {
    const calls = stubFetch();
    const quote = await fetchYahooQuote("PM", { fresh: true });

    expect(quote.price).toBe(201.5);
    expect(calls[0]).toMatchObject({ cache: "no-store" });
    expect(calls[0]).not.toHaveProperty("next");
  });

  it("keeps the 5-minute revalidation by default", async () => {
    const calls = stubFetch();
    await fetchYahooQuote("PM");

    expect(calls[0]).toMatchObject({ next: { revalidate: 300 } });
  });
});
