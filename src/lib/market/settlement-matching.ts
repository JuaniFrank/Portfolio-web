import type { InstrumentType } from "@/lib/generated/prisma";

/**
 * Price-ratio linking (design §4). Pure — no Prisma, no fetch.
 *
 * Scope (rev. 4, twice narrowed): this module no longer detects a variant or
 * decides its currency (AD-12's Yahoo oracle does, for the 1,687 Yahoo-covered
 * symbols) and no longer establishes fixed-income membership (AD-13's ISIN
 * does, for the 221 sovereigns/letras). What is left is a refinement over an
 * already currency-partitioned set: which ARS base a confirmed-USD variant
 * belongs to, and whether its split is MEP or CCL.
 */

export type SettlementQuote = {
  ticker: string;
  type: InstrumentType;
  /** data912 `c` (last). null/0/non-finite ⇒ this row is not eligible this run. */
  price: number | null;
  /** AD-12 verdict. "ARS" ⇒ base candidate · "USD" ⇒ variant · null ⇒ not
   * linked by this module at all (AD-13 owns fixed-income membership). */
  currency: "ARS" | "USD" | null;
};

export type ReferenceRates = {
  /** ARS per USD, CCL. null ⇒ no CCL anchor this run. */
  ccl: number | null;
  /** ARS per USD, MEP. null ⇒ no MEP anchor this run. */
  mep: number | null;
  /** Date backing the rates. Older than MAX_RATE_AGE_DAYS ⇒ no split/pairing at all. */
  asOf: Date;
};

export type SettlementLink = {
  /** null ⇒ USD confirmed, base not identified (or pairing withheld). */
  baseTicker: string | null;
  variantTicker: string;
  type: InstrumentType;
  /** "USD" ⇒ settles in USD, MEP vs CCL not determined (AD-1). */
  settlement: "USD" | "MEP" | "CCL";
  ratio: number | null;
  /** |ratio/anchor - 1|, for logging and for the acceptance assertions. */
  distance: number | null;
};

export type UnlinkedReason = "no-quote" | "no-candidate" | "out-of-band" | "ambiguous";

export type LinkPlan = {
  links: SettlementLink[];
  /** USD symbols whose base pairing and/or MEP/CCL split stayed open — a
   * reporting-only view; the currency itself is still asserted via `links`. */
  unlinked: Array<{ ticker: string; reason: UnlinkedReason }>;
  skippedReason?: "stale-rates" | "no-rates";
};

/** ±2%: a staleness sanity band on the base pairing, not a false-positive
 * filter — AD-12 already excluded every ARS symbol from candidacy. */
const TOLERANCE = 0.02;
/** 0.5pp minimum gap between the distance to each anchor. Below it the split
 * is undetermined ⇒ settlement stays "USD" (the pairing is still kept). */
const MIN_SEPARATION = 0.005;
/** Weekend + one holiday. Beyond it the anchor is not comparable to today's quotes. */
const MAX_RATE_AGE_DAYS = 3;
/** Candidate *generator* only — a search-space reduction, never a rule that
 * decides a link on its own. */
const PREFIX_AFFINITY = 3;

function isEligiblePrice(price: number | null): price is number {
  return typeof price === "number" && Number.isFinite(price) && price > 0;
}

function sharesAffinity(variantTicker: string, baseTicker: string): boolean {
  if (variantTicker.startsWith(baseTicker)) return true;
  return variantTicker.slice(0, PREFIX_AFFINITY) === baseTicker.slice(0, PREFIX_AFFINITY);
}

function unlinkedUsd(v: SettlementQuote, ratio: number | null = null, distance: number | null = null): SettlementLink {
  return {
    baseTicker: null,
    variantTicker: v.ticker,
    type: v.type,
    settlement: "USD",
    ratio,
    distance,
  };
}

export function planSettlementLinks(
  quotes: SettlementQuote[],
  rates: ReferenceRates,
  now: Date = new Date()
): LinkPlan {
  // Step 0 — group partition. A symbol with neither ARS nor USD confirmed by
  // the currency oracle is not linked by this module at all: it emits
  // nothing and stays FR-3 unlinked-but-tradable.
  const bases = quotes.filter((quote) => quote.currency === "ARS");
  const variants = quotes.filter((quote) => quote.currency === "USD");

  const ccl = rates.ccl !== null && Number.isFinite(rates.ccl) && rates.ccl > 0 ? rates.ccl : null;
  const mep = rates.mep !== null && Number.isFinite(rates.mep) && rates.mep > 0 ? rates.mep : null;

  const ageMs = now.getTime() - rates.asOf.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  const stale = ageDays > MAX_RATE_AGE_DAYS;

  // Step 1 — rate gate. A full skip never empties currency: every
  // confirmed-USD symbol still emits settlement: "USD" (AD-12's verdict does
  // not depend on an FX anchor). Only the split and the base pairing are
  // withheld.
  if ((ccl === null && mep === null) || stale) {
    return {
      links: variants.map((v) => unlinkedUsd(v)),
      unlinked: [],
      skippedReason: stale ? "stale-rates" : "no-rates",
    };
  }

  const links: SettlementLink[] = [];
  const unlinked: Array<{ ticker: string; reason: UnlinkedReason }> = [];

  for (const v of variants) {
    // Step 2 — eligibility. Losing the price must not lose the currency.
    if (!isEligiblePrice(v.price)) {
      links.push(unlinkedUsd(v));
      unlinked.push({ ticker: v.ticker, reason: "no-quote" });
      continue;
    }
    const variantPrice = v.price;

    // Step 3 — candidate generation (Yahoo-covered slice only; fixed income
    // never reaches this module at all, see step 0). Same type, ARS-priced
    // higher than the USD variant, and prefix/3-char affinity — a
    // search-space reduction, never a rule that decides a link on its own.
    const candidates = bases.filter(
      (b) =>
        b.type === v.type &&
        isEligiblePrice(b.price) &&
        b.price > variantPrice &&
        sharesAffinity(v.ticker, b.ticker)
    );

    if (candidates.length === 0) {
      links.push(unlinkedUsd(v));
      unlinked.push({ ticker: v.ticker, reason: "no-candidate" });
      continue;
    }

    // Step 4-5 — ratio + nearest-anchor assignment. Accept a base pairing
    // iff its ratio lands within TOLERANCE of the nearer anchor.
    const accepted: Array<{ base: SettlementQuote; ratio: number; dCcl: number; dMep: number }> = [];
    for (const b of candidates) {
      const ratio = b.price! / variantPrice;
      const dCcl = ccl !== null ? Math.abs(ratio / ccl - 1) : Infinity;
      const dMep = mep !== null ? Math.abs(ratio / mep - 1) : Infinity;
      if (Math.min(dCcl, dMep) <= TOLERANCE) {
        accepted.push({ base: b, ratio, dCcl, dMep });
      }
    }

    if (accepted.length === 0) {
      links.push(unlinkedUsd(v));
      unlinked.push({ ticker: v.ticker, reason: "out-of-band" });
      continue;
    }

    // Step 6 — one winner per variant. Two or more accepted bases: the
    // currency is still asserted, only the pairing is withheld.
    if (accepted.length > 1) {
      links.push(unlinkedUsd(v));
      unlinked.push({ ticker: v.ticker, reason: "ambiguous" });
      continue;
    }

    const winner = accepted[0]!;
    const separation = Math.abs(winner.dCcl - winner.dMep);
    const nearestDistance = Math.min(winner.dCcl, winner.dMep);

    if (separation < MIN_SEPARATION) {
      // The split is undetermined — keep the base link, degrade to "USD".
      links.push({
        baseTicker: winner.base.ticker,
        variantTicker: v.ticker,
        type: v.type,
        settlement: "USD",
        ratio: winner.ratio,
        distance: nearestDistance,
      });
      continue;
    }

    links.push({
      baseTicker: winner.base.ticker,
      variantTicker: v.ticker,
      type: v.type,
      settlement: winner.dCcl < winner.dMep ? "CCL" : "MEP",
      ratio: winner.ratio,
      distance: nearestDistance,
    });
  }

  return { links, unlinked };
}
