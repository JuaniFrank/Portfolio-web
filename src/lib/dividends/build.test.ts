import { describe, expect, it } from "vitest";
import { buildDividendsPageData } from "./build";
import type { ReceivedDividend } from "./types";

describe("buildDividendsPageData", () => {
  it("sorts byTicker by unified gross when cclToday is available", () => {
    const received: ReceivedDividend[] = [
      {
        id: "1",
        tradeDate: "2026-03-15T12:00:00.000Z",
        ticker: "YPFD",
        instrumentType: "STOCK_AR",
        instrumentName: "YPF S.A.",
        currencyCode: "ARS",
        grossUsd: "0.00",
        grossArs: "10000.00",
        taxUsd: "0.00",
        taxArs: "500.00",
        netUsd: "0.00",
        netArs: "9500.00",
        cclAtPayment: null,
      },
      {
        id: "2",
        tradeDate: "2026-04-10T12:00:00.000Z",
        ticker: "AAPL",
        instrumentType: "CEDEAR",
        instrumentName: "Apple Inc.",
        currencyCode: "USD",
        grossUsd: "50.00",
        grossArs: "0.00",
        taxUsd: "0.00",
        taxArs: "1200.00",
        netUsd: "50.00",
        netArs: "0.00",
        cclAtPayment: null,
      },
    ];

    const result = buildDividendsPageData({
      received,
      upcoming: [],
      holdings: [
        { ticker: "AAPL", quantity: "10", instrumentName: "Apple Inc." },
        { ticker: "YPFD", quantity: "20", instrumentName: "YPF S.A." },
      ],
      cclToday: 1200,
      yahooErrors: [],
    });

    // 50 USD * 1200 = 60,000 ARS > 10,000 ARS -> AAPL should be first
    expect(result.byTicker[0]?.ticker).toBe("AAPL");
    expect(result.byTicker[0]?.grossUsd).toBe("50.00");
    expect(result.byTicker[1]?.ticker).toBe("YPFD");
    expect(result.byTicker[1]?.grossArs).toBe("10000.00");
    expect(result.cclToday).toBe("1200.00");
  });

  it("calculates KPIs and unified totals accurately", () => {
    const received: ReceivedDividend[] = [
      {
        id: "1",
        tradeDate: "2026-03-15T12:00:00.000Z",
        ticker: "AAPL",
        instrumentType: "CEDEAR",
        instrumentName: "Apple Inc.",
        currencyCode: "USD",
        grossUsd: "100.00",
        grossArs: "0.00",
        taxUsd: "0.00",
        taxArs: "2500.00",
        netUsd: "100.00",
        netArs: "0.00",
        cclAtPayment: null,
      },
    ];

    const result = buildDividendsPageData({
      received,
      upcoming: [],
      holdings: [{ ticker: "AAPL", quantity: "5", instrumentName: "Apple Inc." }],
      cclToday: 1100,
      yahooErrors: [],
    });

    expect(result.kpis.totalGrossUsd).toBe("100.00");
    expect(result.kpis.totalGrossArs).toBe("0.00");
    expect(result.kpis.totalGrossUnifiedArs).toBe("110000.00");
    expect(result.kpis.totalTaxArs).toBe("2500.00");
    expect(result.kpis.totalPayments).toBe(1);
  });
});
