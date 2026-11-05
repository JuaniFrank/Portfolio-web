import { describe, expect, it } from "vitest";
import {
  buildActivosSearch,
  kindForView,
  resolveInitialSelection,
  sortInstrumentsPortfolioFirst,
  viewForKind,
} from "./activos-selection";
import type { MonitoringInstrument } from "./types";

const inst = (
  id: string,
  ticker: string,
  opts: { isCedear?: boolean; inPortfolio?: boolean } = {}
): MonitoringInstrument =>
  ({
    id,
    ticker,
    name: ticker,
    isCedear: opts.isCedear ?? false,
    inPortfolio: opts.inPortfolio ?? false,
  }) as MonitoringInstrument;

const list = [
  inst("1", "GGAL"),
  inst("2", "AAPL", { isCedear: true, inPortfolio: true }),
  inst("3", "YPFD", { inPortfolio: true }),
];

describe("kindForView / viewForKind", () => {
  it("maps views to kinds", () => {
    expect(kindForView("subyacente", true)).toBe("cedear-underlying");
    expect(kindForView("cedear", true)).toBe("native");
    expect(kindForView(null, true)).toBe("cedear-underlying");
    expect(kindForView("cedear", false)).toBe("native");
  });

  it("maps kinds back to views", () => {
    expect(viewForKind("cedear-underlying")).toBe("subyacente");
    expect(viewForKind("native")).toBe("cedear");
  });
});

describe("resolveInitialSelection", () => {
  it("honours a requested ticker case-insensitively", () => {
    expect(resolveInitialSelection(list, { ticker: "ggal", vista: null })).toEqual({
      instrumentId: "1",
      kind: "native",
    });
  });

  it("honours the requested view for a CEDEAR", () => {
    expect(resolveInitialSelection(list, { ticker: "AAPL", vista: "cedear" })).toEqual({
      instrumentId: "2",
      kind: "native",
    });
  });

  it("falls back to the first portfolio instrument for an unknown ticker", () => {
    expect(resolveInitialSelection(list, { ticker: "NOPE", vista: null })).toEqual({
      instrumentId: "2",
      kind: "cedear-underlying",
    });
  });

  it("falls back to the first instrument when nothing is in the portfolio", () => {
    expect(resolveInitialSelection([inst("9", "ZZZ")], { ticker: null, vista: null })).toEqual({
      instrumentId: "9",
      kind: "native",
    });
  });

  it("returns null for an empty catalog", () => {
    expect(resolveInitialSelection([], { ticker: "AAPL", vista: null })).toBeNull();
  });
});

describe("buildActivosSearch", () => {
  it("includes the view only for CEDEARs", () => {
    expect(buildActivosSearch("AAPL", "cedear-underlying", true)).toBe(
      "?ticker=AAPL&vista=subyacente"
    );
    expect(buildActivosSearch("AAPL", "native", true)).toBe("?ticker=AAPL&vista=cedear");
    expect(buildActivosSearch("GGAL", "native", false)).toBe("?ticker=GGAL");
  });
});

describe("sortInstrumentsPortfolioFirst", () => {
  it("puts portfolio instruments first, keeping relative order, without mutating", () => {
    const sorted = sortInstrumentsPortfolioFirst(list);
    expect(sorted.map((i) => i.ticker)).toEqual(["AAPL", "YPFD", "GGAL"]);
    expect(list.map((i) => i.ticker)).toEqual(["GGAL", "AAPL", "YPFD"]);
  });
});
