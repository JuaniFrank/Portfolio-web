/**
 * Duplicate detection for imports.
 *
 * Two independent signals, surfaced together in the warning dialog:
 *
 *  1. **File level** — an ImportBatch with the same `fileHash` already exists
 *     for this user. Strong evidence the whole file was imported before.
 *  2. **Row level** — individual rows whose `idempotencyHash` already exists in
 *     `Transaction`. This is the authoritative check: it catches overlapping
 *     date ranges across two different files, which the file hash cannot.
 *
 * Historically `commitImportBatch` skipped duplicate rows silently. Detection
 * now runs *before* the commit so the user gets to decide — and because
 * `Transaction` is keyed on `[idempotencyHash, idempotencyVersion]`, choosing
 * "import anyway" is representable without touching the schema.
 */

import Decimal from "decimal.js";
import type { TransactionType } from "@/lib/generated/prisma";
import type { ParsedImportRowData } from "./types";

/** A row that collides with an already-persisted transaction. */
export type DuplicateRow = {
  rowNumber: number;
  idempotencyHash: string;
  /** ISO string. */
  tradeDate: string;
  type: TransactionType;
  ticker: string | null;
  quantity: string;
  netAmount: string;
  currencyCode: string;
  description: string;
  /**
   * How the collision was found: the exact idempotency hash, or the same
   * content (date, type, ticker, currency, amounts) at a different row number.
   */
  matchedBy: "hash" | "content";
  /** The transaction already in the database. */
  existing: {
    transactionId: string;
    /** ISO string — when the colliding transaction was created. */
    createdAt: string;
    /** Name of the file it came from, when it came from an import. */
    fileName: string | null;
    brokerName: string | null;
    /** Highest idempotencyVersion currently stored for this hash. */
    maxVersion: number;
  };
};

/** A previous batch that used the exact same file. */
export type DuplicateBatch = {
  importBatchId: string;
  fileName: string;
  /** ISO string. */
  committedAt: string | null;
  createdAt: string;
  rowsImported: number;
  brokerName: string;
};

export type DuplicateCheckResult = {
  /** Batches with the same fileHash. Empty when the file is new. */
  sameFileBatches: DuplicateBatch[];
  /** Rows already present in `Transaction`. */
  duplicateRows: DuplicateRow[];
  /** Rows that would be inserted if the user chooses "skip". */
  freshCount: number;
  /** Total rows evaluated. */
  totalCount: number;
};

export function hasDuplicates(result: DuplicateCheckResult): boolean {
  return result.sameFileBatches.length > 0 || result.duplicateRows.length > 0;
}

/**
 * Build the display payload for one duplicate row. Kept pure and separate from
 * the Prisma query so it can be unit-tested and reused if another broker path
 * needs it.
 */
export function toDuplicateRow(args: {
  rowNumber: number;
  idempotencyHash: string;
  parsed: ParsedImportRowData;
  existing: DuplicateRow["existing"];
  matchedBy: DuplicateRow["matchedBy"];
}): DuplicateRow {
  const { rowNumber, idempotencyHash, parsed, existing, matchedBy } = args;
  return {
    rowNumber,
    idempotencyHash,
    tradeDate: parsed.tradeDate,
    type: parsed.type,
    ticker: parsed.ticker,
    quantity: parsed.quantity,
    netAmount: parsed.netAmount,
    currencyCode: parsed.currencyCode,
    description: parsed.description,
    matchedBy,
    existing,
  };
}

/** A parsed file row, with the hash the commit would store for it. */
export type IncomingRowForMatch = {
  rowNumber: number;
  idempotencyHash: string;
  parsed: ParsedImportRowData;
};

/**
 * A persisted transaction reduced to the comparable shape of a parsed row.
 * Amounts are the stored decimals as strings; `tradeDate` is any date string.
 */
export type ExistingTransactionForMatch = {
  transactionId: string;
  idempotencyHash: string;
  idempotencyVersion: number;
  /** ISO string. */
  createdAt: string;
  fileName: string | null;
  brokerName: string | null;
  tradeDate: string;
  type: TransactionType;
  ticker: string | null;
  currencyCode: string;
  quantity: string;
  netAmount: string;
  externalId: string | null;
};

/** Numerically equal decimals compare equal ("100" == "100.00"). */
function normalizeDecimal(value: string): string {
  try {
    return new Decimal(value).toFixed();
  } catch {
    return value.trim();
  }
}

/** Calendar day (UTC) of a date string; falls back to the raw text if unparseable. */
function normalizeDay(value: string): string {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? value : new Date(time).toISOString().slice(0, 10);
}

type Comparable = {
  tradeDate: string;
  type: TransactionType;
  ticker: string | null;
  currencyCode: string;
  quantity: string;
  netAmount: string;
};

/** externalId is deliberately not part of the key: it is only compared when both sides have one. */
function contentKey(c: Comparable): string {
  return [
    normalizeDay(c.tradeDate),
    c.type,
    c.ticker ?? "",
    c.currencyCode,
    normalizeDecimal(c.quantity),
    normalizeDecimal(c.netAmount),
  ].join("|");
}

function toMatch(e: ExistingTransactionForMatch): DuplicateRow["existing"] {
  return {
    transactionId: e.transactionId,
    createdAt: e.createdAt,
    fileName: e.fileName,
    brokerName: e.brokerName,
    maxVersion: e.idempotencyVersion,
  };
}

/**
 * Pair incoming rows with already-registered transactions.
 *
 * The idempotency hash includes the row number, so it only finds a movement
 * sitting on the same row of the same file; the content key finds the same
 * movement anywhere else (overlapping exports). Matching is multiplicity-aware:
 * each existing transaction is consumed by at most one incoming row, so the
 * intentional "same movement twice" groups are not over-flagged.
 *
 * Exact hash matches are paired first, then the remaining rows by content.
 */
export function matchImportDuplicates(
  rows: IncomingRowForMatch[],
  existing: ExistingTransactionForMatch[]
): DuplicateRow[] {
  const consumed = new Set<string>();
  const matches = new Map<number, { match: ExistingTransactionForMatch; by: "hash" | "content" }>();

  const byHash = new Map<string, ExistingTransactionForMatch[]>();
  const byContent = new Map<string, ExistingTransactionForMatch[]>();
  for (const e of existing) {
    const hashed = byHash.get(e.idempotencyHash);
    if (hashed) hashed.push(e);
    else byHash.set(e.idempotencyHash, [e]);

    const key = contentKey(e);
    const keyed = byContent.get(key);
    if (keyed) keyed.push(e);
    else byContent.set(key, [e]);
  }

  for (const row of rows) {
    const candidate = byHash.get(row.idempotencyHash)?.find((e) => !consumed.has(e.transactionId));
    if (!candidate) continue;
    consumed.add(candidate.transactionId);
    matches.set(row.rowNumber, { match: candidate, by: "hash" });
  }

  for (const row of rows) {
    if (matches.has(row.rowNumber)) continue;
    const { externalId } = row.parsed;
    const candidate = byContent.get(contentKey(row.parsed))?.find(
      (e) =>
        !consumed.has(e.transactionId) &&
        (!externalId || !e.externalId || externalId === e.externalId)
    );
    if (!candidate) continue;
    consumed.add(candidate.transactionId);
    matches.set(row.rowNumber, { match: candidate, by: "content" });
  }

  return rows.flatMap((row) => {
    const found = matches.get(row.rowNumber);
    if (!found) return [];
    return [
      toDuplicateRow({
        rowNumber: row.rowNumber,
        idempotencyHash: row.idempotencyHash,
        parsed: row.parsed,
        existing: toMatch(found.match),
        matchedBy: found.by,
      }),
    ];
  });
}
