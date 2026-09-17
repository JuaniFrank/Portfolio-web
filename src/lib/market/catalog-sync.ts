/**
 * Instrument catalog sync — reconciles our Instrument table against the live
 * BYMA universe from data912.
 *
 * Idempotent by design (safe to re-run):
 *   - new symbol      → create (active = true), with currency/settlement
 *                       resolved from the AD-12 currency oracle (never
 *                       guessed — resolveCurrencyCode's ARS-fallback is gone)
 *   - existing symbol → keep, reactivate if it had been delisted
 *   - vanished symbol → active = false (SOFT delist; never delete — Transaction
 *                       rows FK Instrument and history must survive)
 *
 * Reconciliation is scoped to the catalog domain (venueCode = BYMA + the five
 * ingested types) so it never touches manual/foreign instruments.
 *
 * Pipeline order (design §3.3, §5.1) — NFR-1 / this file's own T-38 gate:
 *   1 fetch live rows (one reader, AD-10)                — data912-universe.ts
 *   2 snapshots (same rows, no second fetch)               — market-snapshots.ts
 *   3 resolveUniverseCurrencies()  (AD-12 oracle)          — yahoo-metadata-client.ts
 *   4 planSettlementLinks()        (pure, AD-4)            — settlement-matching.ts
 *   5 apply the plan to EXISTING rows (AD-5 lattice)        — in-place UPDATE by id
 *   6 reconcile (create/reactivate/delist)                  — instrumentKey, both sides
 *   7 link brand-new variants to a brand-new base           — same-batch follow-up
 *   8 enrichUsedInstruments()      last, best-effort        — yahoo-catalog.ts
 *
 * Step 5 before step 6 is what keeps `instrumentKey` stable across a run: a
 * pre-existing row whose stored `currencyCode` is stale (e.g. ARS, should be
 * USD) is upgraded in place before `wanted` is computed, so the stored row
 * and the universe row already agree by the time reconciliation runs —
 * otherwise a stale row would look "missing" from `wanted` and a second,
 * correctly-classified row would be created alongside it (the exact
 * duplicate-row failure mode NFR-1 exists to prevent).
 *
 * A brand-new variant whose base is ALSO brand-new this run is a genuine
 * two-row dependency `createMany` cannot express in one batch: its
 * `settlement` is still set correctly at create time (independent of the
 * base's id), and its `baseInstrumentId` is resolved by step 7 immediately
 * after, once both rows have real ids — no separate run is required, and no
 * currency is ever wrong even for the one sync cycle between them.
 */

import { InstrumentType, Prisma, type Settlement } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchData912Live, type CatalogInstrument } from "./data912-universe";
import { syncLatestData912Snapshots } from "./market-snapshots";
import { enrichUsedInstruments } from "./yahoo-catalog";
import { instrumentKey } from "./instrument-identity";
import { currencyForSettlement, moreSpecific } from "./settlement-classify";
import { planSettlementLinks, type SettlementQuote, type LinkPlan } from "./settlement-matching";
import { fetchMepQuote } from "./dolarapi";

const CATALOG_TYPES: InstrumentType[] = [
  InstrumentType.STOCK_AR,
  InstrumentType.CEDEAR,
  InstrumentType.ON,
  InstrumentType.BOND_AR,
  InstrumentType.LETRA,
];

/** The 1,687-symbol slice AD-12's currency oracle covers. BOND_AR/LETRA are
 * NOT here — their membership comes from Docta's ISIN (AD-13, C8); until
 * that pass runs they are created unlinked at the schema's ARS default,
 * which is FR-3-correct (visible, tradable, no chip), never wrong. */
const YAHOO_ORACLE_TYPES = new Set<InstrumentType>([
  InstrumentType.STOCK_AR,
  InstrumentType.CEDEAR,
  InstrumentType.ON,
]);

const LOG_PREFIX = "[catalog-sync]";

type ExistingRow = {
  id: string;
  ticker: string;
  type: InstrumentType;
  currencyCode: string;
  venueCode: string | null;
  settlement: Settlement;
  active: boolean;
  baseInstrumentId: string | null;
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type CatalogSyncResult = {
  ok: boolean;
  fetched: number;
  created: number;
  reactivated: number;
  delisted: number;
  renamed: number;
  /** Base<->variant links newly applied this run (AD-5). */
  linked: number;
  /** ticker+type groups with more than one active row — reporting only (§3.5). */
  duplicateGroups: number;
  /** AD-12 oracle status. "unavailable" ⇒ this run created no new
   * Yahoo-covered rows and wrote no currency; delist/reactivate still ran. */
  currencyOracle: "ok" | "unavailable";
  error?: string;
};

async function resolveReferenceRates(): Promise<{ ccl: number | null; mep: number | null; asOf: Date }> {
  // Read directly rather than via resolveCclRate(): the linking step needs
  // the row's own `date` for the freshness gate, which resolveCclRate()
  // deliberately hides (design §4.5). ccl-rate.ts itself is NOT modified.
  const cclRow = await prisma.fxRate.findFirst({
    where: { baseCurrencyCode: "USD", quoteCurrencyCode: "ARS", source: "CCL" },
    orderBy: { date: "desc" },
  });

  const today = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
  );
  let mepRow = await prisma.fxRate.findFirst({
    where: { baseCurrencyCode: "USD", quoteCurrencyCode: "ARS", source: "MEP" },
    orderBy: { date: "desc" },
  });

  if (!mepRow || mepRow.date.getTime() < today.getTime()) {
    const quote = await fetchMepQuote();
    if (quote) {
      try {
        mepRow = await prisma.fxRate.upsert({
          where: {
            date_baseCurrencyCode_quoteCurrencyCode_source: {
              date: today,
              baseCurrencyCode: "USD",
              quoteCurrencyCode: "ARS",
              source: "MEP",
            },
          },
          create: {
            date: today,
            baseCurrencyCode: "USD",
            quoteCurrencyCode: "ARS",
            source: "MEP",
            buy: new Prisma.Decimal(quote.buy),
            sell: new Prisma.Decimal(quote.sell),
            mid: new Prisma.Decimal(quote.mid),
          },
          update: {
            buy: new Prisma.Decimal(quote.buy),
            sell: new Prisma.Decimal(quote.sell),
            mid: new Prisma.Decimal(quote.mid),
          },
        });
      } catch (err) {
        console.warn(`${LOG_PREFIX} No se pudo persistir la cotización MEP: ${errorMessage(err)}`);
      }
    }
  }

  return {
    ccl: cclRow ? Number(cclRow.mid) : null,
    mep: mepRow ? Number(mepRow.mid) : null,
    asOf:
      cclRow && mepRow
        ? cclRow.date < mepRow.date
          ? cclRow.date
          : mepRow.date
        : (cclRow?.date ?? mepRow?.date ?? new Date(0)),
  };
}

/** Applies a link plan (AD-5 lattice: never downgrade) to a set of rows
 * addressable by ticker|type, in place — used both for pre-existing rows
 * (step 5) and for same-batch new-variant/new-base pairs (step 7). */
async function applyPlanTo(
  plan: LinkPlan,
  rowsByTickerType: Map<string, { id: string; settlement: Settlement; baseInstrumentId: string | null }>
): Promise<number> {
  let linked = 0;
  for (const link of plan.links) {
    const variant = rowsByTickerType.get(`${link.variantTicker}|${link.type}`);
    if (!variant) continue;
    const base = link.baseTicker ? rowsByTickerType.get(`${link.baseTicker}|${link.type}`) : null;

    const nextSettlement = moreSpecific(variant.settlement, link.settlement as Settlement);
    const nextBaseId = base?.id ?? variant.baseInstrumentId; // NULL-safe: keeps a prior base
    const settlementChanged = nextSettlement !== variant.settlement;
    const baseChanged = Boolean(base?.id) && base!.id !== variant.baseInstrumentId;
    if (!settlementChanged && !baseChanged) continue;

    await prisma.instrument.update({
      where: { id: variant.id },
      data: {
        settlement: nextSettlement,
        currencyCode: currencyForSettlement(nextSettlement),
        baseInstrumentId: nextBaseId,
      },
    });
    variant.settlement = nextSettlement;
    variant.baseInstrumentId = nextBaseId;
    linked += 1;
  }
  return linked;
}

export async function syncInstrumentCatalog(): Promise<CatalogSyncResult> {
  const startedAt = Date.now();
  const errors: string[] = [];

  console.log(`${LOG_PREFIX} Iniciando sync de catálogo de instrumentos...`);

  // --- Step 1: fetch live rows, one reader, one network pass ---
  let universe: CatalogInstrument[];
  try {
    universe = await fetchData912Live({});
  } catch (err) {
    const message = errorMessage(err);
    console.error(`${LOG_PREFIX} Error obteniendo universo de data912: ${message}`);
    return {
      ok: false, fetched: 0, created: 0, reactivated: 0, delisted: 0, renamed: 0,
      linked: 0, duplicateGroups: 0, currencyOracle: "unavailable", error: message,
    };
  }

  console.log(`${LOG_PREFIX} Universo obtenido de data912: ${universe.length} instrumentos`);

  // Guard: an empty universe means every endpoint failed. Bailing out here is
  // what prevents a transient data912 outage from delisting the whole catalog.
  if (universe.length === 0) {
    const message = "Universo vacío — no se tocó el catálogo (probable caída de data912)";
    console.error(`${LOG_PREFIX} ${message}`);
    return {
      ok: false, fetched: 0, created: 0, reactivated: 0, delisted: 0, renamed: 0,
      linked: 0, duplicateGroups: 0, currencyOracle: "unavailable", error: message,
    };
  }

  // --- Step 2: snapshots — threads the SAME rows through, no second fetch ---
  try {
    await syncLatestData912Snapshots(universe);
  } catch (err) {
    console.warn(`${LOG_PREFIX} No se pudieron actualizar snapshots: ${errorMessage(err)}`);
  }

  // --- Step 3: the AD-12 currency oracle (Yahoo-covered slice only) ---
  const yahooCoveredRows = universe.filter((u) => YAHOO_ORACLE_TYPES.has(u.type));
  const { resolveUniverseCurrencies } = await import("./yahoo-metadata-client");

  let currencyVerdicts = new Map<string, { kind: string; currency?: "ARS" | "USD" }>();
  let currencyOracleUnavailable = false;
  if (yahooCoveredRows.length > 0) {
    try {
      currencyVerdicts = await resolveUniverseCurrencies(
        yahooCoveredRows.map((r) => ({ symbol: r.ticker, type: r.type }))
      );
    } catch (err) {
      console.error(`${LOG_PREFIX} Currency oracle transport failure: ${errorMessage(err)}`);
      currencyVerdicts = new Map();
    }
    const verdictValues = [...currencyVerdicts.values()];
    currencyOracleUnavailable =
      verdictValues.length === 0 || verdictValues.every((v) => v.kind === "unavailable");
  }

  if (currencyOracleUnavailable) {
    console.error(
      `${LOG_PREFIX} Currency oracle unavailable — no se crean instrumentos Yahoo-covered ni se escribe moneda este run.`
    );
  }

  // --- Step 4: plan settlement links (pure) ---
  let plan: LinkPlan = { links: [], unlinked: [] };
  if (!currencyOracleUnavailable && yahooCoveredRows.length > 0) {
    const rates = await resolveReferenceRates();
    const quotes: SettlementQuote[] = yahooCoveredRows.map((row) => {
      const verdict = currencyVerdicts.get(row.ticker);
      const currency: "ARS" | "USD" | null =
        verdict?.kind === "currency" && verdict.currency ? verdict.currency : null;
      return { ticker: row.ticker, type: row.type, price: row.price, currency };
    });
    plan = planSettlementLinks(quotes, rates);
  }

  const existing: ExistingRow[] = await prisma.instrument.findMany({
    where: { type: { in: CATALOG_TYPES } },
    select: {
      id: true, ticker: true, type: true, currencyCode: true,
      venueCode: true, settlement: true, active: true, baseInstrumentId: true,
    },
  });

  // --- Step 5: apply the plan to EXISTING rows BEFORE reconciliation ---
  // Keeps `instrumentKey` stable: a stale-currency existing row is upgraded
  // in place, so `wanted` (computed next) never sees it as "missing".
  const existingByTickerType = new Map(existing.map((e) => [`${e.ticker}|${e.type}`, e]));
  let linked = await applyPlanTo(plan, existingByTickerType);

  const dbVenues = new Set((await prisma.venue.findMany({ select: { code: true } })).map((v) => v.code));
  const resolveVenueCode = (): string | null => (dbVenues.has("BYMA") ? "BYMA" : null);
  const resolveTaxJurisdiction = (type: InstrumentType): string => (type === "CEDEAR" ? "US" : "AR");

  /** currencyCode this run resolves for a universe row. `null` ⇒ skip (no
   * evidence this run — never guessed, never defaulted to ARS on create). */
  function resolveCurrencyForRow(row: CatalogInstrument): "ARS" | "USD" | null {
    if (!YAHOO_ORACLE_TYPES.has(row.type)) {
      // Fixed income: not part of this oracle. Created at the schema
      // default (ARS/ARS) — AD-13's ISIN pass (C8) reclassifies it later.
      return "ARS";
    }
    if (currencyOracleUnavailable) return null;
    const verdict = currencyVerdicts.get(row.ticker);
    if (!verdict) return null;
    if (verdict.kind === "currency" && verdict.currency) return verdict.currency;
    // "not-listed" (404) or a per-symbol "unavailable": no evidence this run.
    // Conservative and safe: skip rather than guess. The next run retries.
    return null;
  }

  /** Settlement a brand-new row should be created with, from the plan
   * (independent of whether its base's id is known yet — see step 7). */
  function resolveNewRowSettlement(row: CatalogInstrument, currencyCode: "ARS" | "USD"): Settlement {
    if (currencyCode === "ARS") return "ARS";
    const link = plan.links.find((l) => l.variantTicker === row.ticker && l.type === row.type);
    return (link?.settlement as Settlement | undefined) ?? "USD";
  }

  const venueCode = resolveVenueCode();
  const wanted = new Map<string, CatalogInstrument & { currencyCode: string }>();
  for (const row of universe) {
    const currencyCode = resolveCurrencyForRow(row);
    if (currencyCode === null) continue; // no evidence this run — never created/matched
    wanted.set(instrumentKey({ ticker: row.ticker, type: row.type, currencyCode, venueCode }), {
      ...row,
      currencyCode,
    });
  }

  const existingByKey = new Map(existing.map((e) => [instrumentKey(e), e]));
  const toCreate = [...wanted.values()].filter(
    (i) => !existingByKey.has(instrumentKey({ ...i, venueCode }))
  );

  // --- Step 6: reconcile ---
  let created = 0;
  if (toCreate.length > 0) {
    try {
      const res = await prisma.instrument.createMany({
        data: toCreate.map((i) => ({
          ticker: i.ticker,
          name: i.ticker,
          type: i.type,
          venueCode,
          currencyCode: i.currencyCode,
          // AD-1's hard invariant (currencyCode = currencyForSettlement(settlement))
          // must hold from the first write — a USD-currency row born at the
          // schema's ARS default would violate it, even momentarily.
          settlement: resolveNewRowSettlement(i, i.currencyCode as "ARS" | "USD"),
          taxJurisdiction: resolveTaxJurisdiction(i.type),
          active: true,
        })),
        skipDuplicates: true,
      });
      created = res.count;
    } catch (err) {
      errors.push(`create: ${errorMessage(err)}`);
    }
  }

  const toReactivate = existing.filter((e) => !e.active && wanted.has(instrumentKey(e))).map((e) => e.id);
  let reactivated = 0;
  if (toReactivate.length > 0) {
    try {
      const res = await prisma.instrument.updateMany({ where: { id: { in: toReactivate } }, data: { active: true } });
      reactivated = res.count;
    } catch (err) {
      errors.push(`reactivate: ${errorMessage(err)}`);
    }
  }

  // Yahoo-oracle rows this run could not resolve a currency for (unavailable
  // oracle, 404, or per-symbol failure) must NEVER be soft-delisted just
  // because they are absent from `wanted` this run (AD-5: silence never
  // revokes). Only a row genuinely absent from the universe altogether is
  // delisted.
  const universeTickers = new Set(universe.map((u) => `${u.ticker}|${u.type}`));
  const toDelist = existing
    .filter((e) => e.active && !wanted.has(instrumentKey(e)) && !universeTickers.has(`${e.ticker}|${e.type}`))
    .map((e) => e.id);
  let delisted = 0;
  if (toDelist.length > 0) {
    try {
      const res = await prisma.instrument.updateMany({ where: { id: { in: toDelist } }, data: { active: false } });
      delisted = res.count;
    } catch (err) {
      errors.push(`delist: ${errorMessage(err)}`);
    }
  }

  // --- Step 7: link brand-new variant<->brand-new base pairs ---
  // A pair created together in step 6 has no id to reference until now.
  // Every other row (pre-existing, or new-variant-of-old-base) was already
  // linked at step 5 or born linked at step 6 — this only fills the gap.
  if (created > 0 && !currencyOracleUnavailable) {
    try {
      const newlyCreated = await prisma.instrument.findMany({
        where: { type: { in: [...YAHOO_ORACLE_TYPES] }, active: true },
        select: { id: true, ticker: true, type: true, settlement: true, baseInstrumentId: true },
      });
      const byTickerType = new Map(newlyCreated.map((r) => [`${r.ticker}|${r.type}`, r]));
      linked += await applyPlanTo(plan, byTickerType);
    } catch (err) {
      console.warn(`${LOG_PREFIX} No se pudo enlazar pares nuevo<->nuevo: ${errorMessage(err)}`);
    }
  }

  // --- §3.5 duplicate reporting (never a guard) ---
  let duplicateGroups = 0;
  try {
    const dupRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM (
        SELECT ticker, type FROM "Instrument"
        WHERE "venueCode" = 'BYMA'
        GROUP BY ticker, type HAVING count(*) > 1
      ) t;
    `;
    duplicateGroups = Number(dupRows[0]?.count ?? 0);
  } catch {
    // reporting-only; never fails the sync
  }

  // --- AD-13: ISIN-based linking for fixed income (BOND_AR/LETRA), C8/T-45 ---
  // A completely separate membership mechanism from the Yahoo oracle above;
  // no-ops entirely when Docta is disabled (isDoctaEnabled() = false).
  try {
    const { linkFixedIncomeByIsin } = await import("./fixed-income-linking");
    const rates = await resolveReferenceRates();
    const fixedIncomeResult = await linkFixedIncomeByIsin({ ccl: rates.ccl, mep: rates.mep });
    linked += fixedIncomeResult.groupsLinked;
    if (fixedIncomeResult.budgetExhausted) {
      console.warn(
        `${LOG_PREFIX} Docta ISIN linking: quota agotada este run tras ${fixedIncomeResult.liveCallsMade} llamadas — continúa en la próxima corrida.`
      );
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} ISIN linking (fixed income) omitido: ${errorMessage(err)}`);
  }

  // --- Step 8: enrichment, last, best-effort (Yahoo + Docta, both no-op-safe) ---
  try {
    const used = await prisma.transaction.findMany({
      where: { instrumentId: { not: null } },
      distinct: ["instrumentId"],
      select: { instrumentId: true },
    });
    const usedIds = used.flatMap(({ instrumentId }) => (instrumentId ? [instrumentId] : []));
    await enrichUsedInstruments(usedIds);
    try {
      const { enrichDoctaHeldInstruments } = await import("./docta-enrichment");
      await enrichDoctaHeldInstruments(usedIds);
    } catch (err) {
      console.warn(`${LOG_PREFIX} Enriquecimiento Docta omitido: ${errorMessage(err)}`);
    }
    try {
      const { enrichUnusedEquityProfiles } = await import("./yahoo-catalog");
      await enrichUnusedEquityProfiles(usedIds);
    } catch (err) {
      console.warn(`${LOG_PREFIX} Goteo de perfiles de equities omitido: ${errorMessage(err)}`);
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} Enriquecimiento Yahoo omitido: ${errorMessage(err)}`);
  }

  const ok = errors.length === 0 && !currencyOracleUnavailable;
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `${LOG_PREFIX} Sync ${ok ? "completado" : "completado con errores"} en ${elapsedSec}s — fetched=${universe.length} created=${created} reactivated=${reactivated} delisted=${delisted} linked=${linked}`
  );

  return {
    ok,
    fetched: universe.length,
    created,
    reactivated,
    delisted,
    renamed: 0,
    linked,
    duplicateGroups,
    currencyOracle: currencyOracleUnavailable ? "unavailable" : "ok",
    error: errors.length > 0 ? errors.join("; ") : currencyOracleUnavailable ? "currency oracle unavailable" : undefined,
  };
}
