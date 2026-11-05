import { describe, expect, it } from "vitest";
import {
  buildPositionSummary,
  buildTradeEntries,
  buildTradeMarkers,
  projectTrades,
  type TradeMarkerContext,
  type TradeMarkerInput,
} from "./trade-markers";
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

const nativeArsContext: TradeMarkerContext = {
  kind: "native",
  currency: "ARS",
  nativeArsCloses: [],
  cclByDate: [],
};

describe("monitoreo/trade-markers", () => {
  it("returns no markers for empty trades", () => {
    const bars = [bar("2026-03-09", 100)];
    expect(buildTradeMarkers([], bars, nativeArsContext, [])).toEqual([]);
  });

  it("returns no markers when there are no bars to anchor to", () => {
    expect(buildTradeMarkers([trade()], [], nativeArsContext, [])).toEqual([]);
  });

  it("drops a trade dated before the first bar", () => {
    const bars = [bar("2026-03-06", 100), bar("2026-03-09", 102)];
    expect(buildTradeMarkers([trade({ tradeDate: "2026-02-01" })], bars, nativeArsContext, [])).toEqual([]);
  });

  it("drops a trade dated after the last bar", () => {
    const bars = [bar("2026-03-06", 100), bar("2026-03-09", 102)];
    expect(buildTradeMarkers([trade({ tradeDate: "2026-04-01" })], bars, nativeArsContext, [])).toEqual([]);
  });

  it("snaps a weekend trade date to the next available bar (Monday)", () => {
    const bars = [bar("2026-03-06", 100), bar("2026-03-09", 102)];
    const markers = buildTradeMarkers([trade({ tradeDate: "2026-03-07" })], bars, nativeArsContext, []);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.barTime).toBe("2026-03-09");
  });

  it("emits one marker per trade, never grouping a day", () => {
    const bars = [bar("2026-03-09", 102)];
    const trades = [
      trade({ id: "buy-1", type: "BUY", quantity: 10 }),
      trade({ id: "sell-1", type: "SELL", quantity: 4 }),
    ];
    const markers = buildTradeMarkers(trades, bars, nativeArsContext, []);
    expect(markers).toHaveLength(2);
    expect(markers.map((m) => [m.id, m.side])).toEqual([
      ["buy-1", "buy"],
      ["sell-1", "sell"],
    ]);
    expect(markers[0]!.trade.quantity).toBe(10);
  });

  it("places the marker at the projected chart price, not approximate", () => {
    const bars = [bar("2026-03-09", 102)];
    const [m] = buildTradeMarkers([trade({ price: 101 })], bars, nativeArsContext, []);
    expect(m!.chartPrice).toBe(101);
    expect(m!.approximate).toBe(false);
    expect(m!.projectionMethod).toBe("direct");
  });

  it("flags the marker approximate when the price cannot be projected", () => {
    const bars = [bar("2026-03-09", 102)];
    const [m] = buildTradeMarkers([trade({ currencyCode: "USD" })], bars, nativeArsContext, []);
    expect(m!.chartPrice).toBeNull();
    expect(m!.approximate).toBe(true);
    expect(m!.projectionMethod).toBeNull();
    expect(m!.trade.changeSinceTradePct).toBeNull();
  });

  it("computes change since trade vs the last close using the chart price", () => {
    const bars = [bar("2026-03-09", 100), bar("2026-03-10", 110)];
    const [m] = buildTradeMarkers([trade({ price: 100 })], bars, nativeArsContext, []);
    expect(m!.trade.changeSinceTradePct).toBeCloseTo(10, 5);
  });

  it("computes change on the underlying view using the projected price", () => {
    const bars = [bar("2026-03-09", 100), bar("2026-03-10", 110)];
    const ctx: TradeMarkerContext = {
      kind: "cedear-underlying",
      currency: "USD",
      nativeArsCloses: [{ date: "2026-03-09", close: 10000 }],
      cclByDate: [],
    };
    // chartPrice = 5000 * (100 / 10000) = 50; last close 110 -> +120%
    const [m] = buildTradeMarkers([trade({ price: 5000 })], bars, ctx, []);
    expect(m!.chartPrice).toBeCloseTo(50, 8);
    expect(m!.trade.changeSinceTradePct).toBeCloseTo(120, 5);
  });

  it("returns null change when a corporate event happened after the trade date", () => {
    const bars = [bar("2026-03-09", 100), bar("2026-03-10", 110)];
    const [m] = buildTradeMarkers([trade()], bars, nativeArsContext, ["2026-03-10"]);
    expect(m!.trade.changeSinceTradePct).toBeNull();
    expect(m!.chartPrice).toBe(100);
  });

  it("still computes change when corporate events are on or before the trade date", () => {
    const bars = [bar("2026-03-09", 100), bar("2026-03-10", 110)];
    const [m] = buildTradeMarkers([trade()], bars, nativeArsContext, ["2026-03-09", "2026-01-01"]);
    expect(m!.trade.changeSinceTradePct).toBeCloseTo(10, 5);
  });

  it("sorts markers by bar date, then trade date", () => {
    const bars = [bar("2026-03-06", 100), bar("2026-03-09", 102), bar("2026-03-10", 103)];
    const trades = [
      trade({ id: "later", tradeDate: "2026-03-10" }),
      trade({ id: "sun", tradeDate: "2026-03-08" }),
      trade({ id: "mon", tradeDate: "2026-03-09" }),
      trade({ id: "earlier", tradeDate: "2026-03-06" }),
    ];
    const markers = buildTradeMarkers(trades, bars, nativeArsContext, []);
    expect(markers.map((m) => m.id)).toEqual(["earlier", "sun", "mon", "later"]);
  });

  it("projects against separate projection bars when given", () => {
    const visible = [bar("2026-03-10", 110)];
    const full = [bar("2026-03-09", 100), bar("2026-03-10", 110)];
    const ctx: TradeMarkerContext = {
      kind: "cedear-underlying",
      currency: "USD",
      nativeArsCloses: [{ date: "2026-03-09", close: 10000 }],
      cclByDate: [],
    };
    const markers = buildTradeMarkers([trade({ tradeDate: "2026-03-10", price: 10000 })], visible, ctx, [], full);
    // trade on 03-10 has no cedear close on that date but 03-09 is within lookback: 10000 * (110/10000)
    expect(markers[0]!.chartPrice).toBeCloseTo(110, 8);
  });
});

describe("monitoreo/trade-markers projectTrades", () => {
  it("projects every trade independent of the bar range, sorted by trade date", () => {
    const ctx = { ...nativeArsContext, bars: [bar("2026-03-10", 110)] };
    const out = projectTrades(
      [trade({ id: "b", tradeDate: "2020-01-02" }), trade({ id: "a", tradeDate: "2020-01-01", type: "SELL" })],
      ctx
    );
    expect(out.map((t) => t.id)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({ side: "sell", chartPrice: 100, projectionMethod: "direct", quantity: 10 });
  });
});

describe("monitoreo/trade-markers same-day ordering", () => {
  it("projectTrades puts BUY before SELL within the same trade date", () => {
    const ctx = { ...nativeArsContext, bars: [bar("2026-03-10", 110)] };
    const out = projectTrades(
      [trade({ id: "s", tradeDate: "2026-03-05", type: "SELL" }), trade({ id: "b", tradeDate: "2026-03-05" })],
      ctx
    );
    expect(out.map((t) => t.id)).toEqual(["b", "s"]);
  });

  it("buildPositionSummary closes the position for a same-day sell listed before its buy", () => {
    const s = buildPositionSummary(
      [
        { side: "sell", quantity: 10, chartPrice: 120, tradeDate: "2026-03-05" },
        { side: "buy", quantity: 10, chartPrice: 100, tradeDate: "2026-03-05" },
      ],
      130,
      []
    );
    expect(s.quantity).toBe(0);
  });
});

describe("monitoreo/trade-markers buildPositionSummary", () => {
  const t = (
    side: "buy" | "sell",
    quantity: number,
    chartPrice: number | null,
    tradeDate = "2026-03-01"
  ) => ({ side, quantity, chartPrice, tradeDate });

  it("computes the average cost and unrealized percentage", () => {
    const s = buildPositionSummary([t("buy", 10, 100), t("buy", 10, 200)], 180, []);
    expect(s.quantity).toBe(20);
    expect(s.avgCost).toBe(150);
    expect(s.unrealizedPct).toBeCloseTo(20, 8);
    expect(s.comparable).toBe(true);
  });

  it("keeps the average unchanged on sells", () => {
    const s = buildPositionSummary(
      [t("buy", 10, 100, "2026-03-01"), t("sell", 4, 500, "2026-03-02"), t("buy", 4, 200, "2026-03-03")],
      150,
      []
    );
    expect(s.quantity).toBe(10);
    // 6*100 + 4*200 = 1400 / 10
    expect(s.avgCost).toBe(140);
  });

  it("resets when the position is closed", () => {
    const s = buildPositionSummary(
      [t("buy", 10, 100, "2026-01-01"), t("sell", 10, 120, "2026-01-02"), t("buy", 5, 300, "2026-01-03")],
      330,
      []
    );
    expect(s.quantity).toBe(5);
    expect(s.avgCost).toBe(300);
    expect(s.unrealizedPct).toBeCloseTo(10, 8);
  });

  it("reports a flat position with no avg cost", () => {
    const s = buildPositionSummary([t("buy", 10, 100), t("sell", 10, 120)], 130, []);
    expect(s).toEqual({ quantity: 0, avgCost: null, unrealizedPct: null, comparable: true });
  });

  it("is not comparable when an open buy has no chart price", () => {
    const s = buildPositionSummary([t("buy", 10, 100), t("buy", 5, null)], 150, []);
    expect(s).toEqual({ quantity: 15, avgCost: null, unrealizedPct: null, comparable: false });
  });

  it("ignores a closed round trip with missing prices", () => {
    const s = buildPositionSummary(
      [t("buy", 10, null, "2026-01-01"), t("sell", 10, null, "2026-01-02"), t("buy", 2, 50, "2026-02-01")],
      60,
      []
    );
    expect(s.avgCost).toBe(50);
    expect(s.comparable).toBe(true);
  });

  it("is not comparable when a corporate event follows an open-position trade", () => {
    const s = buildPositionSummary([t("buy", 10, 100, "2026-03-01")], 150, ["2026-03-05"]);
    expect(s).toEqual({ quantity: 10, avgCost: null, unrealizedPct: null, comparable: false });
  });

  it("stays comparable when the event predates the open position", () => {
    const s = buildPositionSummary(
      [t("buy", 10, 100, "2026-01-01"), t("sell", 10, 100, "2026-01-02"), t("buy", 5, 100, "2026-03-01")],
      150,
      ["2026-02-01"]
    );
    expect(s.comparable).toBe(true);
    expect(s.avgCost).toBe(100);
  });

  it("returns an empty summary for no trades", () => {
    expect(buildPositionSummary([], 100, [])).toEqual({
      quantity: 0,
      avgCost: null,
      unrealizedPct: null,
      comparable: true,
    });
  });

  describe("buildTradeEntries", () => {
    it("keeps trades outside the bar range, without a bar anchor", () => {
      const bars = [bar("2026-03-06", 100), bar("2026-03-09", 102)];
      const entries = buildTradeEntries(
        [
          trade({ id: "old", tradeDate: "2026-02-01" }),
          trade({ id: "in", tradeDate: "2026-03-09" }),
          trade({ id: "future", tradeDate: "2026-04-01" }),
        ],
        bars,
        nativeArsContext,
        []
      );
      expect(entries.map((e) => [e.id, e.barTime])).toEqual([
        ["old", null],
        ["in", "2026-03-09"],
        ["future", null],
      ]);
    });

    it("lists every trade when there are no bars", () => {
      const entries = buildTradeEntries([trade()], [], nativeArsContext, []);
      expect(entries).toHaveLength(1);
      expect(entries[0]!.barTime).toBeNull();
      expect(entries[0]!.trade.changeSinceTradePct).toBeNull();
    });

    it("returns nothing for no trades", () => {
      expect(buildTradeEntries([], [bar("2026-03-09", 100)], nativeArsContext, [])).toEqual([]);
    });

    it("projects out-of-range trades against projectionBars", () => {
      const bars = [bar("2026-03-09", 102)];
      const entries = buildTradeEntries(
        [trade({ id: "old", tradeDate: "2026-02-01", price: 90 })],
        bars,
        nativeArsContext,
        []
      );
      expect(entries[0]!.chartPrice).toBe(90);
    });
  });
});
