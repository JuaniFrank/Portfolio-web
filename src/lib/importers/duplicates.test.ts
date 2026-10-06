import { describe, expect, it } from "vitest";
import { TransactionType } from "@/lib/generated/prisma";
import {
  matchImportDuplicates,
  type ExistingTransactionForMatch,
  type IncomingRowForMatch,
} from "./duplicates";
import type { ParsedImportRowData } from "./types";

function parsed(overrides: Partial<ParsedImportRowData> = {}): ParsedImportRowData {
  return {
    type: TransactionType.BUY,
    tradeDate: "2026-03-10T00:00:00.000Z",
    settlementDate: "",
    ticker: "AAPL",
    instrumentType: null,
    quantity: "10",
    price: "100",
    currencyCode: "ARS",
    grossAmount: "1000",
    netAmount: "-1000",
    externalId: null,
    description: "Compra",
    brokerFxRate: null,
    ...overrides,
  };
}

function incoming(
  rowNumber: number,
  overrides: Partial<ParsedImportRowData> = {},
  idempotencyHash = `hash-in-${rowNumber}`
): IncomingRowForMatch {
  return { rowNumber, idempotencyHash, parsed: parsed(overrides) };
}

function existing(
  id: string,
  overrides: Partial<ExistingTransactionForMatch> = {}
): ExistingTransactionForMatch {
  return {
    transactionId: id,
    idempotencyHash: `hash-db-${id}`,
    idempotencyVersion: 1,
    createdAt: "2026-03-11T12:00:00.000Z",
    fileName: "previous.xlsx",
    brokerName: "Balanz",
    tradeDate: "2026-03-10T00:00:00.000Z",
    type: TransactionType.BUY,
    ticker: "AAPL",
    currencyCode: "ARS",
    quantity: "10",
    netAmount: "-1000",
    externalId: null,
    ...overrides,
  };
}

describe("matchImportDuplicates", () => {
  it("flags a row whose idempotency hash already exists", () => {
    const result = matchImportDuplicates(
      [incoming(2, {}, "same-hash")],
      [existing("a", { idempotencyHash: "same-hash", netAmount: "-999" })]
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.rowNumber).toBe(2);
    expect(result[0]?.matchedBy).toBe("hash");
    expect(result[0]?.existing.transactionId).toBe("a");
  });

  it("flags a row with the same content at a different row number", () => {
    const result = matchImportDuplicates([incoming(40)], [existing("a")]);
    expect(result).toHaveLength(1);
    expect(result[0]?.matchedBy).toBe("content");
    expect(result[0]?.existing.transactionId).toBe("a");
  });

  it("flags only one of two identical file rows against one existing transaction", () => {
    const result = matchImportDuplicates([incoming(2), incoming(3)], [existing("a")]);
    expect(result).toHaveLength(1);
  });

  it("flags only one of one file row against two identical existing transactions", () => {
    const result = matchImportDuplicates([incoming(2)], [existing("a"), existing("b")]);
    expect(result).toHaveLength(1);
  });

  it("flags both rows when two identical existing transactions cover them", () => {
    const result = matchImportDuplicates(
      [incoming(2), incoming(3)],
      [existing("a"), existing("b")]
    );
    expect(result.map((r) => r.existing.transactionId).sort()).toEqual(["a", "b"]);
  });

  it("pairs exact hash matches before content matches", () => {
    const result = matchImportDuplicates(
      [incoming(2, {}, "h2"), incoming(3, {}, "h3")],
      [existing("a", { idempotencyHash: "h3" })]
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.rowNumber).toBe(3);
    expect(result[0]?.matchedBy).toBe("hash");
  });

  it("treats numerically equal decimals as equal", () => {
    const result = matchImportDuplicates(
      [incoming(2, { quantity: "10", netAmount: "-1000" })],
      [existing("a", { quantity: "10.00000000", netAmount: "-1000.00" })]
    );
    expect(result).toHaveLength(1);
  });

  it("ignores the time of day of the trade date", () => {
    const result = matchImportDuplicates(
      [incoming(2, { tradeDate: "2026-03-10" })],
      [existing("a", { tradeDate: "2026-03-10T03:00:00.000Z" })]
    );
    expect(result).toHaveLength(1);
  });

  it("does not flag a different amount", () => {
    const result = matchImportDuplicates(
      [incoming(2, { netAmount: "-1001" })],
      [existing("a")]
    );
    expect(result).toEqual([]);
  });

  it("does not flag when both sides have a different externalId", () => {
    const result = matchImportDuplicates(
      [incoming(2, { externalId: "X1" })],
      [existing("a", { externalId: "X2" })]
    );
    expect(result).toEqual([]);
  });

  it("matches on content when only one side has an externalId", () => {
    const result = matchImportDuplicates(
      [incoming(2, { externalId: "X1" })],
      [existing("a", { externalId: null })]
    );
    expect(result).toHaveLength(1);
  });
});
