import type { CorporateEventType } from "@/lib/generated/prisma";

/**
 * Minimal event shape passed to the holdings builder.
 * effectiveDate is YYYY-MM-DD string for lexical comparison.
 */
export type CorporateEventForBuilder = {
  instrumentId: string;
  eventType: CorporateEventType;
  /** YYYY-MM-DD */
  effectiveDate: string;
  /** Decimal string */
  numerator: string;
  /** Decimal string */
  denominator: string;
};

/** Full event shape returned to the UI. */
export type CorporateEventDTO = {
  id: string;
  instrumentId: string;
  ticker: string;
  eventType: CorporateEventType;
  /** YYYY-MM-DD */
  effectiveDate: string;
  /** Decimal string */
  numerator: string;
  /** Decimal string */
  denominator: string;
  notes: string | null;
  appliedAt: string;
};

/** Post-event position snapshot used in the preview pane. */
export type ProjectedPosition = {
  instrumentId: string;
  ticker: string;
  /** Decimal string */
  quantity: string;
  /** Decimal string — price per unit (PPP) */
  avgPriceArs: string;
  /** Decimal string — invariant total cost */
  costBasisArs: string;
};

export type EventActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };
