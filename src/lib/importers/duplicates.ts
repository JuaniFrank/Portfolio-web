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
}): DuplicateRow {
  const { rowNumber, idempotencyHash, parsed, existing } = args;
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
    existing,
  };
}
