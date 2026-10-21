import { describe, expect, it } from "vitest";
import type { NormalizedImportRow } from "@/lib/importers/types";
import {
  availableTransactionTypes,
  dateInputToIso,
  excludeInvalidRows,
  filterReviewRows,
  formatReviewAmount,
  isoToDateInput,
  toggleVisibleExcluded,
} from "./review-view";

function row(
  rowNumber: number,
  status: NormalizedImportRow["status"],
  parsed?: { ticker: string | null; type: "BUY" | "SELL" | "DIVIDEND_CASH" }
): NormalizedImportRow {
  return {
    rowNumber,
    status,
    messages: [],
    raw: {} as NormalizedImportRow["raw"],
    parsed: parsed
      ? ({ ticker: parsed.ticker, type: parsed.type } as NormalizedImportRow["parsed"])
      : undefined,
  };
}

const rows = [
  row(1, "valid", { ticker: "AAPL", type: "BUY" }),
  row(2, "warning", { ticker: "MSFT", type: "SELL" }),
  row(3, "invalid"),
  row(4, "valid", { ticker: "AL30", type: "BUY" }),
];

const base = { tickerQuery: "", typeFilter: "all" };

describe("filterReviewRows", () => {
  it("committable hides excluded and invalid rows", () => {
    const out = filterReviewRows(rows, new Set([4]), { ...base, tab: "committable" });
    expect(out.map((r) => r.rowNumber)).toEqual([1, 2]);
  });

  it("excluded shows only excluded rows", () => {
    expect(filterReviewRows(rows, new Set([4]), { ...base, tab: "excluded" }).map((r) => r.rowNumber)).toEqual([4]);
  });

  it("problems shows warnings and errors", () => {
    expect(filterReviewRows(rows, new Set(), { ...base, tab: "problems" }).map((r) => r.rowNumber)).toEqual([2, 3]);
  });

  it("all keeps everything", () => {
    expect(filterReviewRows(rows, new Set([1]), { ...base, tab: "all" })).toHaveLength(4);
  });

  it("matches the ticker query case-insensitively, trimmed; unparsed rows have no ticker", () => {
    const out = filterReviewRows(rows, new Set(), { ...base, tab: "all", tickerQuery: " ms " });
    expect(out.map((r) => r.rowNumber)).toEqual([2]);
  });

  it("filters by transaction type; unparsed rows never match a specific type", () => {
    const out = filterReviewRows(rows, new Set(), { ...base, tab: "all", typeFilter: "BUY" });
    expect(out.map((r) => r.rowNumber)).toEqual([1, 4]);
  });
});

describe("availableTransactionTypes", () => {
  it("returns the distinct parsed types sorted by their label", () => {
    const types = availableTransactionTypes([
      ...rows,
      row(5, "valid", { ticker: "X", type: "DIVIDEND_CASH" }),
    ]);
    expect(types).toEqual(["BUY", "DIVIDEND_CASH", "SELL"]);
  });
});

describe("toggleVisibleExcluded", () => {
  it("excludes every visible row when all are currently included", () => {
    expect(toggleVisibleExcluded(new Set([9]), [1, 2], true).sort()).toEqual([1, 2, 9]);
  });

  it("re-includes the visible rows when some are excluded", () => {
    expect(toggleVisibleExcluded(new Set([1, 9]), [1, 2], false)).toEqual([9]);
  });
});

describe("excludeInvalidRows", () => {
  it("adds invalid row numbers without duplicating existing exclusions", () => {
    expect(excludeInvalidRows(rows, new Set([3, 1])).sort()).toEqual([1, 3]);
  });
});

describe("date input helpers", () => {
  it("round-trips a day through the noon-UTC ISO convention", () => {
    expect(dateInputToIso("2024-05-06")).toBe("2024-05-06T12:00:00.000Z");
    expect(isoToDateInput("2024-05-06T12:00:00.000Z")).toBe("2024-05-06");
  });
});

describe("formatReviewAmount", () => {
  it("formats numbers with two decimals in es-AR and passes through non-numeric text", () => {
    expect(formatReviewAmount("1234.5")).toBe("1.234,50");
    expect(formatReviewAmount("abc")).toBe("abc");
  });
});
