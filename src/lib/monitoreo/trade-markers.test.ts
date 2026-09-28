import { describe, expect, it } from "vitest";
import { buildTradeMarkers, type TradeMarkerInput } from "./trade-markers";
import type { MonitoringBar } from "./types";

function bar(time: string, close: number): MonitoringBar {
  return { time, open: close, high: close, low: close, close, volume: 1000 };
}

function trade(overrides: Partial<TradeMarkerInput> = {}): TradeMarkerInput {
  return {
    id: "t1",
    tradeDate: "2026-03-09",
    type: "BUY",
    quantity: 10,
    price: 100,
    currencyCode: "ARS",
    grossAmount: 1000,
    fees: 5,
    ...overrides,
  };
}

const nativeArsContext = { kind: "native" as const, currency: "ARS" as const };

describe("monitoreo/trade-markers", () => {
  it("returns no markers for empty trades", () => {
    const bars = [bar("2026-03-09", 100)];
    expect(buildTradeMarkers([], bars, nativeArsContext, [])).toEqual([]);
  });

  it("returns no markers when there are no bars to anchor to", () => {
    const trades = [trade()];
    expect(buildTradeMarkers(trades, [], nativeArsContext, [])).toEqual([]);
  });

  it("drops a trade dated before the first bar", () => {
    const bars = [bar("2026-03-06", 100), bar("2026-03-09", 102)];
    const trades = [trade({ tradeDate: "2026-02-01" })];
    expect(buildTradeMarkers(trades, bars, nativeArsContext, [])).toEqual([]);
  });

  it("drops a trade dated after the last bar", () => {
    const bars = [bar("2026-03-06", 100), bar("2026-03-09", 102)];
    const trades = [trade({ tradeDate: "2026-04-01" })];
    expect(buildTradeMarkers(trades, bars, nativeArsContext, [])).toEqual([]);
  });

  it("snaps a weekend trade date to the next available bar (Monday)", () => {
    // Friday 2026-03-06, Saturday trade, next bar Monday 2026-03-09
    const bars = [bar("2026-03-06", 100), bar("2026-03-09", 102)];
    const trades = [trade({ tradeDate: "2026-03-07" })]; // Saturday

    const markers = buildTradeMarkers(trades, bars, nativeArsContext, []);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.barTime).toBe("2026-03-09");
  });

  it("aggregates same-day buy and sell into a single mixed marker", () => {
    const bars = [bar("2026-03-09", 102)];
    const trades = [
      trade({ id: "buy-1", type: "BUY", quantity: 10, tradeDate: "2026-03-09" }),
      trade({ id: "sell-1", type: "SELL", quantity: 4, tradeDate: "2026-03-09" }),
    ];

    const markers = buildTradeMarkers(trades, bars, nativeArsContext, []);
    expect(markers).toHaveLength(1);
    const marker = markers[0]!;
    expect(marker.side).toBe("mixed");
    expect(marker.trades).toHaveLength(2);
    expect(marker.totals).toEqual({
      totalBuyQuantity: 10,
      totalSellQuantity: 4,
      netQuantity: 6,
      totalGrossAmount: 2000,
      totalFees: 10,
    });
  });

  it("groups trades from different dates that snap to the same bar", () => {
    const bars = [bar("2026-03-06", 100), bar("2026-03-09", 102)];
    const trades = [
      trade({ id: "sat", tradeDate: "2026-03-07" }), // Saturday -> snaps to 03-09
      trade({ id: "sun", tradeDate: "2026-03-08" }), // Sunday -> snaps to 03-09
    ];

    const markers = buildTradeMarkers(trades, bars, nativeArsContext, []);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.barTime).toBe("2026-03-09");
    expect(markers[0]!.trades).toHaveLength(2);
  });

  it("keeps side 'buy' when all trades in the group are BUY, 'sell' when all are SELL", () => {
    const bars = [bar("2026-03-09", 102)];
    const buyMarkers = buildTradeMarkers(
      [trade({ type: "BUY" })],
      bars,
      nativeArsContext,
      []
    );
    expect(buyMarkers[0]!.side).toBe("buy");

    const sellMarkers = buildTradeMarkers(
      [trade({ type: "SELL" })],
      bars,
      nativeArsContext,
      []
    );
    expect(sellMarkers[0]!.side).toBe("sell");
  });

  it("computes change since trade vs the series' last close when comparable", () => {
    const bars = [bar("2026-03-09", 100), bar("2026-03-10", 110)];
    const trades = [trade({ tradeDate: "2026-03-09", price: 100 })];

    const markers = buildTradeMarkers(trades, bars, nativeArsContext, []);
    expect(markers[0]!.trades[0]!.changeSinceTradePct).toBeCloseTo(10, 5); // (110-100)/100 * 100
  });

  it("returns null change when the series kind is not native", () => {
    const bars = [bar("2026-03-09", 100), bar("2026-03-10", 110)];
    const trades = [trade({ tradeDate: "2026-03-09", price: 100 })];

    const markers = buildTradeMarkers(
      trades,
      bars,
      { kind: "cedear-underlying", currency: "ARS" },
      []
    );
    expect(markers[0]!.trades[0]!.changeSinceTradePct).toBeNull();
  });

  it("returns null change when the trade currency differs from the series currency", () => {
    const bars = [bar("2026-03-09", 100), bar("2026-03-10", 110)];
    const trades = [trade({ tradeDate: "2026-03-09", price: 100, currencyCode: "USD" })];

    const markers = buildTradeMarkers(trades, bars, nativeArsContext, []);
    expect(markers[0]!.trades[0]!.changeSinceTradePct).toBeNull();
  });

  it("returns null change when a corporate event happened after the trade date", () => {
    const bars = [bar("2026-03-09", 100), bar("2026-03-10", 110)];
    const trades = [trade({ tradeDate: "2026-03-09", price: 100 })];

    const markers = buildTradeMarkers(trades, bars, nativeArsContext, ["2026-03-10"]);
    expect(markers[0]!.trades[0]!.changeSinceTradePct).toBeNull();
  });

  it("still computes change when a corporate event happened before or on the trade date", () => {
    const bars = [bar("2026-03-09", 100), bar("2026-03-10", 110)];
    const trades = [trade({ tradeDate: "2026-03-09", price: 100 })];

    const markers = buildTradeMarkers(trades, bars, nativeArsContext, ["2026-03-09", "2026-01-01"]);
    expect(markers[0]!.trades[0]!.changeSinceTradePct).toBeCloseTo(10, 5);
  });

  it("returns markers sorted ascending by bar date", () => {
    const bars = [bar("2026-03-06", 100), bar("2026-03-09", 102), bar("2026-03-10", 103)];
    const trades = [
      trade({ id: "t-later", tradeDate: "2026-03-10" }),
      trade({ id: "t-earlier", tradeDate: "2026-03-06" }),
    ];

    const markers = buildTradeMarkers(trades, bars, nativeArsContext, []);
    expect(markers.map((m) => m.barTime)).toEqual(["2026-03-06", "2026-03-10"]);
  });
});
