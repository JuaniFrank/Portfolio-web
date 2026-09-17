/**
 * AD-13 ISIN-based linking for fixed income (BOND_AR/LETRA). Wired into the
 * enrichment pass, not the Yahoo-oracle pipeline (§5.1) — Docta's ISIN is a
 * completely separate membership signal from AD-12's currency oracle.
 *
 * MEASURED (2026-09-16, against the live Docta service — corrects an
 * earlier, unverified "essentially free" assumption): the "basic" plan's
 * real ceiling is **15 requests/day** and **10 requests/minute**, not
 * hundreds. Linking all 221 fixed-income tickers in one run is impossible
 * under this budget. This is now a **prioritize-then-drip** pass, not a
 * whole-universe one:
 *   - held instruments (referenced by ≥1 `Transaction`) are ordered first
 *     (`docta-linking-plan.ts`, pure and tested) — a user holding a handful
 *     of bonds gets them linked the day the sync next runs;
 *   - everything else fills in over subsequent runs, deliberately: an
 *     unlinked fixed-income row is still fully searchable and tradable
 *     (FR-3) — deferring it costs a settlement chip for a few days, nothing
 *     the user cannot trade without;
 *   - **this is a one-time ramp, not a daily cost**: once a ticker's ISIN
 *     lookup resolves (an ISIN, or a confirmed 404 — see
 *     `docta-client.ts`'s permanent cache), it never needs another live
 *     call. The 221-ticker backlog is a fixed, shrinking pool, not a
 *     recurring 221-calls-a-day bill.
 *
 * Prisma orchestrator — untested by convention (NFR-2); the ordering/budget
 * decision lives in the pure, tested `docta-linking-plan.ts`, and the
 * price-ordering settlement split below is intentionally small and
 * self-contained rather than routed through `planSettlementLinks` (T-22),
 * whose candidate-GENERATION machinery (prefix/3-char affinity search) does
 * not apply here: ISIN already IS the confirmed membership, so there is
 * nothing left to search for.
 */

import { prisma } from "@/lib/prisma";
import { InstrumentType } from "@/lib/generated/prisma";
import { fetchDoctaInstrument, hasResolvedDoctaInstrumentCache, isDoctaEnabled } from "./docta-client";
import { groupByIsin, type IsinRow } from "./isin-grouping";
import { moreSpecific } from "./settlement-classify";
import { planDoctaLinkingBatch, type FixedIncomeCandidate } from "./docta-linking-plan";

const FIXED_INCOME_TYPES: InstrumentType[] = [InstrumentType.BOND_AR, InstrumentType.LETRA];

/** Same anchors as settlement-matching.ts's calibration (§4.4) — reused here
 * only for the rare 2-member-group MEP/CCL split; membership itself never
 * depends on these. */
const CCL_ANCHOR_FALLBACK = 1582;
const MEP_ANCHOR_FALLBACK = 1526;

/**
 * MEASURED (2026-09-16): Docta's "basic" plan allows 15 requests/day total,
 * shared across every Docta endpoint (this linking pass AND the cashflow
 * path in `docta-enrichment.ts` both draw on it). Sibling constant to
 * `ENRICH_CONCURRENCY`/`ENRICH_BUDGET_MS` (`yahoo-catalog.ts`, design §9.2)
 * — same budget-and-cap pattern, sized for a much smaller quota. Kept well
 * under the 15/day ceiling to leave headroom for the cashflow path.
 */
export const DOCTA_LINKING_BUDGET_PER_RUN = 8;

/**
 * MEASURED (2026-09-16): `x-ratelimit-limit: 10` per minute. This module's
 * fetch loop is sequential (never parallel), but a tight sequential loop
 * with no pacing can still exceed 10 requests/minute if each round-trip is
 * fast. 6.5s between live calls keeps this run under ~9.2 requests/minute
 * even in the worst case, with margin.
 */
const DOCTA_MIN_REQUEST_INTERVAL_MS = 6_500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FixedIncomeLinkingResult = {
  /** Live Docta lookups actually attempted this run (excludes cache hits). */
  liveCallsMade: number;
  isinPopulated: number;
  groupsLinked: number;
  /** True when a 429 stopped this run before every planned candidate was
   * tried — the remaining candidates are untouched, not failed. */
  budgetExhausted: boolean;
};

/**
 * For active BOND_AR/LETRA instruments, fetch Docta's instrument metadata
 * (cached forever per ticker, T-44), held-first and budget-capped (see
 * module docstring), populate `isin`, group by shared ISIN, and — for a
 * confirmed group of 2 or 3 — assign settlement by descending price
 * (highest = ARS/base, then MEP, then CCL), same as AD-13b's rule for the
 * Yahoo-covered slice. A group of 1 (no ISIN match) just gets its `isin`
 * populated; it stays unlinked-but-tradable (FR-3).
 */
export async function linkFixedIncomeByIsin(
  rates: { ccl: number | null; mep: number | null } = { ccl: null, mep: null }
): Promise<FixedIncomeLinkingResult> {
  if (!isDoctaEnabled()) {
    return { liveCallsMade: 0, isinPopulated: 0, groupsLinked: 0, budgetExhausted: false };
  }

  const instruments = await prisma.instrument.findMany({
    where: { type: { in: FIXED_INCOME_TYPES }, active: true },
    select: { id: true, ticker: true, type: true, isin: true, settlement: true, baseInstrumentId: true },
  });

  // --- Plan: who gets a live lookup this run (pure, tested) ---
  const unresolvedTickers = instruments.filter((i) => !i.isin).map((i) => i.ticker);
  const resolvedCache = await hasResolvedDoctaInstrumentCache(unresolvedTickers);

  const heldRows = await prisma.transaction.findMany({
    where: { instrumentId: { in: instruments.map((i) => i.id) } },
    distinct: ["instrumentId"],
    select: { instrumentId: true },
  });
  const heldIds = new Set(heldRows.flatMap((r) => (r.instrumentId ? [r.instrumentId] : [])));

  const candidatesByTicker = new Map(instruments.map((i) => [i.ticker, i]));
  const candidates: FixedIncomeCandidate[] = instruments.map((i) => ({
    ticker: i.ticker,
    isHeld: heldIds.has(i.id),
    needsDoctaLookup: !i.isin && !resolvedCache.has(i.ticker),
  }));

  const plan = planDoctaLinkingBatch(candidates, DOCTA_LINKING_BUDGET_PER_RUN);

  // --- Fetch: stop the moment the quota is spent (never retry a 429) ---
  const isinByInstrumentId = new Map(instruments.map((i) => [i.id, i.isin]));
  let liveCallsMade = 0;
  let isinPopulated = 0;
  let budgetExhausted = false;

  for (const candidate of plan) {
    const inst = candidatesByTicker.get(candidate.ticker);
    if (!inst) continue;

    const result = await fetchDoctaInstrument(inst.ticker);

    if (result.kind === "rate-limited") {
      budgetExhausted = true;
      break; // stop this run entirely — every further call would also 429
    }

    // "error" (transport/parse failure) has no `cached` field — it can only
    // ever be a live attempt (a cached outcome is always ok/not-found).
    const wasCached = result.kind !== "error" && result.cached;
    if (!wasCached) {
      liveCallsMade += 1;
    }

    if (result.kind === "ok") {
      const isin = result.data.data[0]?.isin;
      if (isin) {
        try {
          await prisma.instrument.update({ where: { id: inst.id }, data: { isin } });
          isinByInstrumentId.set(inst.id, isin);
          isinPopulated += 1;
        } catch (error) {
          console.warn(
            `[fixed-income-linking] no se pudo guardar isin de ${inst.ticker}: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
    // "not-found" (permanently cached by docta-client.ts) and "error"
    // (transport failure, safe to retry a later run) both leave isin at
    // null here — nothing more to do this run for this ticker.

    // Pace live calls only — a cache hit costs no quota and needs no delay.
    if (!wasCached) {
      await delay(DOCTA_MIN_REQUEST_INTERVAL_MS);
    }
  }

  // --- Group + settle: runs over EVERY instrument's current isin state,
  // whether resolved this run, a prior run, or still null (unlinked). ---
  const rows: Array<IsinRow & { id: string; type: InstrumentType; price: number | null }> = [];
  for (const inst of instruments) {
    const snapshot = await prisma.marketSnapshot.findUnique({ where: { instrumentId: inst.id } });
    rows.push({
      id: inst.id,
      ticker: inst.ticker,
      type: inst.type,
      isin: isinByInstrumentId.get(inst.id) ?? null,
      price: snapshot?.price ? Number(snapshot.price) : null,
    });
  }

  const groups = groupByIsin(rows);
  let groupsLinked = 0;

  const ccl = rates.ccl ?? CCL_ANCHOR_FALLBACK;
  const mep = rates.mep ?? MEP_ANCHOR_FALLBACK;

  for (const group of groups) {
    if (group.tickers.length < 2) continue; // group of 1: isin populated, stays unlinked

    const members = group.tickers
      .map((t) => rows.find((r) => r.ticker === t))
      .filter(
        (r): r is (typeof rows)[number] =>
          r !== undefined && r.price !== null && r.price > 0
      )
      .sort((a, b) => b.price! - a.price!); // descending price

    if (members.length < 2) continue; // not enough priced members to order

    const base = members[0]!;
    const variants = members.slice(1);

    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i]!;
      let settlement: "MEP" | "CCL" | "USD";

      if (variants.length >= 2) {
        // Group of 3+: descending price order alone names the split —
        // higher of the remaining is MEP, lower is CCL (AD-13b).
        settlement = i === 0 ? "MEP" : "CCL";
      } else {
        // Group of exactly 2: order alone cannot name which one it is —
        // fall back to the nearest-anchor ratio, same method as §4.
        const ratio = base.price! / variant.price!;
        const dCcl = Math.abs(ratio / ccl - 1);
        const dMep = Math.abs(ratio / mep - 1);
        settlement = dCcl < dMep ? "CCL" : "MEP";
      }

      const existingSettlement = instruments.find((i) => i.id === variant.id)?.settlement ?? "ARS";
      const nextSettlement = moreSpecific(existingSettlement, settlement);
      const existingBaseId = instruments.find((i) => i.id === variant.id)?.baseInstrumentId ?? null;
      if (nextSettlement === existingSettlement && existingBaseId === base.id) continue;

      try {
        await prisma.instrument.update({
          where: { id: variant.id },
          data: {
            settlement: nextSettlement,
            currencyCode: "USD",
            baseInstrumentId: existingBaseId ?? base.id,
          },
        });
        groupsLinked += 1;
      } catch (error) {
        console.warn(
          `[fixed-income-linking] no se pudo enlazar ${variant.ticker} -> ${base.ticker}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  return { liveCallsMade, isinPopulated, groupsLinked, budgetExhausted };
}
