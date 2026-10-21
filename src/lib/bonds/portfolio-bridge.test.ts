import { describe, expect, it } from "vitest";
import type { FetchOnPricesResult } from "@/lib/market/data912";
import { valuateOnPositions } from "./portfolio-bridge";
import type { TradeForBondHoldings } from "./holdings";

const trade: TradeForBondHoldings = {
  instrumentId: "b1",
  ticker: "YMCJO",
  instrumentType: "ON",
  type: "BUY",
  quantity: "100",
  netAmount: "100",
  currencyCode: "USD",
  tradeDate: "2025-01-15T12:00:00.000Z",
};

const fx = { cclAt: () => 1000 };
const names = new Map([["b1", "YPF 2033"]]);

function prices(quotes: FetchOnPricesResult["quotes"], stale = false): FetchOnPricesResult {
  return { quotes, stale };
}

describe("valuateOnPositions — unpriced ON", () => {
  it("values an ON with no quote at cost (not at 0) and flags it", () => {
    const [p] = valuateOnPositions([trade], prices(new Map()), 1200, names, fx);

    expect(p!.priceUnavailable).toBe(true);
    expect(p!.marketValueArs).toBe(p!.costBasisArs);
    expect(p!.marketValueArs).toBe("100000.00");
    expect(p!.pnlArs).toBe("0.00");
    expect(p!.pnlPercent).toBe("0.00");
    expect(p!.marketValueUsd).toBe("100.00");
    expect(p!.pnlUsd).toBe("0.00");
    expect(p!.pnlPercentUsd).toBe("0.00");
  });

  it("does not flag a priced ON", () => {
    const quotes = new Map([
      ["YMCJO", { symbol: "YMCJO", c: 120000, px_bid: 0, px_ask: 0, pct_change: 0 }],
    ]);
    const [p] = valuateOnPositions([trade], prices(quotes), 1200, names, fx);

    expect(p!.priceUnavailable).toBe(false);
    expect(p!.priceStale).toBe(false);
    expect(p!.marketValueArs).toBe("120000.00");
  });

  it("carries the stale flag from a cached quote", () => {
    const quotes = new Map([
      ["YMCJO", { symbol: "YMCJO", c: 120000, px_bid: 0, px_ask: 0, pct_change: 0 }],
    ]);
    const [p] = valuateOnPositions([trade], prices(quotes, true), 1200, names, fx);

    expect(p!.priceStale).toBe(true);
    expect(p!.priceUnavailable).toBe(false);
  });
});
