import type { Settlement } from "@/lib/generated/prisma";

/**
 * `currencyCode = currencyForSettlement(settlement)` for every row, always
 * (AD-1's hard invariant). Shared by `catalog-sync.ts` and `commit-import.ts`
 * so they cannot disagree.
 */
export function currencyForSettlement(settlement: Settlement): "ARS" | "USD" {
  return settlement === "ARS" ? "ARS" : "USD";
}

/** ARS is least specific; USD confirms the currency without the MEP/CCL
 * split; MEP and CCL are incomparable siblings, both strictly more specific
 * than USD. */
const RANK: Record<Settlement, number> = { ARS: 0, USD: 1, MEP: 2, CCL: 2 };

/**
 * The AD-5 lattice: `ARS < USD < MEP|CCL`. Returns whichever of `stored` /
 * `incoming` is more specific — never downgrades `MEP`/`CCL` to `USD`, and
 * never downgrades `USD` to `ARS`. `MEP` and `CCL` are siblings at the same
 * rank: an incoming value equal to the stored one is a no-op, and neither
 * sibling downgrades the other (a run that produces the "wrong" sibling
 * still keeps the previously-confirmed one — silence never revokes a
 * confirmed link).
 */
export function moreSpecific(stored: Settlement, incoming: Settlement): Settlement {
  if (incoming === stored) return stored;
  return RANK[incoming] > RANK[stored] ? incoming : stored;
}
