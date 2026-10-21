import { describe, expect, it } from "vitest";
import {
  NO_PRICE_ISSUES,
  classifyQuoteCoverage,
  onlyHeldInstruments,
  mergePriceIssues,
  onPriceIssues,
} from "./price-issues";

const instruments = [
  { id: "1", ticker: "GGAL" },
  { id: "2", ticker: "AAPL" },
  { id: "3", ticker: "YPFD" },
];

describe("classifyQuoteCoverage", () => {
  it("reports nothing when every instrument has a fresh price", () => {
    const prices = new Map([
      ["1", "10"],
      ["2", "20"],
      ["3", "30"],
    ]);
    expect(classifyQuoteCoverage(instruments, prices, [])).toEqual(NO_PRICE_ISSUES);
  });

  it("flags an instrument without any price as valued at cost", () => {
    const prices = new Map([["1", "10"], ["3", "30"]]);
    expect(classifyQuoteCoverage(instruments, prices, ["2"])).toEqual({
      valuedAtCost: ["AAPL"],
      stale: [],
    });
  });

  it("flags a failed refresh that fell back to a cached price as stale", () => {
    const prices = new Map([["1", "10"], ["2", "20"], ["3", "30"]]);
    expect(classifyQuoteCoverage(instruments, prices, ["3"])).toEqual({
      valuedAtCost: [],
      stale: ["YPFD"],
    });
  });

  it("does not double-report: no price wins over failed", () => {
    const result = classifyQuoteCoverage(instruments, new Map(), ["1"]);
    expect(result.valuedAtCost).toEqual(["AAPL", "GGAL", "YPFD"]);
    expect(result.stale).toEqual([]);
  });
});

describe("onPriceIssues", () => {
  it("maps unavailable to valued-at-cost and stale to stale", () => {
    expect(
      onPriceIssues([
        { ticker: "MCC3O", priceUnavailable: true, priceStale: false },
        { ticker: "YMCJO", priceUnavailable: false, priceStale: true },
        { ticker: "TLCMO", priceUnavailable: false, priceStale: false },
      ])
    ).toEqual({ valuedAtCost: ["MCC3O"], stale: ["YMCJO"] });
  });
});

describe("mergePriceIssues", () => {
  it("unions, dedupes and sorts", () => {
    expect(
      mergePriceIssues(
        { valuedAtCost: ["B"], stale: ["Z"] },
        { valuedAtCost: ["A", "B"], stale: [] }
      )
    ).toEqual({ valuedAtCost: ["A", "B"], stale: ["Z"] });
  });
});

describe("onlyHeldInstruments", () => {
  it("drops fully sold instruments so they are not reported as valued at cost", () => {
    const held = onlyHeldInstruments(instruments, [{ instrumentId: "1" }, { instrumentId: "3" }]);
    expect(held.map((i) => i.ticker)).toEqual(["GGAL", "YPFD"]);
    // A sold ticker (AAPL) without a quote must not show up as an issue.
    expect(classifyQuoteCoverage(held, new Map([["1", "10"], ["3", "30"]]), [])).toEqual(
      NO_PRICE_ISSUES
    );
  });
});
