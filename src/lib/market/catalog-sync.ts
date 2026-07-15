/**
 * Instrument catalog sync — reconciles our Instrument table against the live
 * BYMA universe from data912.
 *
 * Idempotent by design (safe to re-run):
 *   - new symbol      → create (active = true)
 *   - existing symbol → keep, reactivate if it had been delisted
 *   - vanished symbol → active = false (SOFT delist; never delete — Transaction
 *                       rows FK Instrument and history must survive)
 *
 * Reconciliation is scoped to the catalog domain (venueCode = BYMA + the three
 * ingested types) so it never touches manual/foreign instruments.
 */

import { InstrumentType } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchInstrumentUniverse, type CatalogInstrument } from "./data912-universe";
import { CURATED_INSTRUMENT_NAMES, displayNameFor } from "./instrument-names";

const CATALOG_TYPES: InstrumentType[] = [
  InstrumentType.STOCK_AR,
  InstrumentType.CEDEAR,
  InstrumentType.ON,
];

function identityKey(i: {
  ticker: string;
  type: InstrumentType;
  currencyCode: string;
  venueCode: string | null;
}): string {
  return `${i.ticker}|${i.type}|${i.currencyCode}|${i.venueCode ?? ""}`;
}

export type CatalogSyncResult = {
  ok: boolean;
  fetched: number;
  created: number;
  reactivated: number;
  delisted: number;
  renamed: number;
  error?: string;
};

export async function syncInstrumentCatalog(): Promise<CatalogSyncResult> {
  const universe = await fetchInstrumentUniverse();

  // Guard: an empty universe means every endpoint failed. Bailing out here is
  // what prevents a transient data912 outage from delisting the whole catalog.
  if (universe.length === 0) {
    return {
      ok: false,
      fetched: 0,
      created: 0,
      reactivated: 0,
      delisted: 0,
      renamed: 0,
      error: "Universo vacío — no se tocó el catálogo (probable caída de data912)",
    };
  }

  const wanted = new Map<string, CatalogInstrument>();
  for (const i of universe) wanted.set(identityKey(i), i);

  const existing = await prisma.instrument.findMany({
    where: { venueCode: "BYMA", type: { in: CATALOG_TYPES } },
    select: { id: true, ticker: true, type: true, currencyCode: true, venueCode: true, active: true },
  });
  const existingByKey = new Map(existing.map((e) => [identityKey(e), e]));

  // --- Creates ---
  const toCreate = [...wanted.values()].filter((i) => !existingByKey.has(identityKey(i)));
  let created = 0;
  if (toCreate.length > 0) {
    const res = await prisma.instrument.createMany({
      data: toCreate.map((i) => ({
        ticker: i.ticker,
        name: displayNameFor(i.ticker),
        type: i.type,
        venueCode: i.venueCode,
        currencyCode: i.currencyCode,
        taxJurisdiction: i.currencyCode === "ARS" ? "AR" : "US",
        active: true,
      })),
      skipDuplicates: true,
    });
    created = res.count;
  }

  // --- Reactivations (previously soft-delisted, now listed again) ---
  const toReactivate = existing
    .filter((e) => !e.active && wanted.has(identityKey(e)))
    .map((e) => e.id);
  let reactivated = 0;
  if (toReactivate.length > 0) {
    const res = await prisma.instrument.updateMany({
      where: { id: { in: toReactivate } },
      data: { active: true },
    });
    reactivated = res.count;
  }

  // --- Soft delists (listed before, gone now) ---
  const toDelist = existing
    .filter((e) => e.active && !wanted.has(identityKey(e)))
    .map((e) => e.id);
  let delisted = 0;
  if (toDelist.length > 0) {
    const res = await prisma.instrument.updateMany({
      where: { id: { in: toDelist } },
      data: { active: false },
    });
    delisted = res.count;
  }

  // --- Name enrichment: backfill curated names onto rows still named as their
  // ticker. Bounded by the curated map (~dozens), one update per entry. ---
  let renamed = 0;
  for (const [ticker, name] of Object.entries(CURATED_INSTRUMENT_NAMES)) {
    const res = await prisma.instrument.updateMany({
      where: { ticker, type: { in: CATALOG_TYPES }, venueCode: "BYMA", name: ticker },
      data: { name },
    });
    renamed += res.count;
  }

  return {
    ok: true,
    fetched: universe.length,
    created,
    reactivated,
    delisted,
    renamed,
  };
}
