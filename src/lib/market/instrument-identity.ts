import type { InstrumentType } from "@/lib/generated/prisma";

/**
 * The row's identity (AD-2). Mirrors `@@unique([ticker, type, venueCode,
 * currencyCode])`. This is the ONLY exported identity function in the
 * codebase — `catalog-sync.ts`'s malformed `identityKey()` and
 * `commit-import.ts`'s locally-defined `instrumentKey()` both import this
 * instead of computing their own (T-34/T-36).
 *
 * Safe forever on a reset database only because `currencyCode` is immutable
 * after ingestion (AD-0, FR-14): both sides of a reconciliation compute the
 * same string for the same listing on every run.
 */
export function instrumentKey(i: {
  ticker: string;
  type: InstrumentType;
  currencyCode: string;
  venueCode: string | null;
}): string {
  return `${i.ticker}|${i.type}|${i.currencyCode}|${i.venueCode ?? ""}`;
}
