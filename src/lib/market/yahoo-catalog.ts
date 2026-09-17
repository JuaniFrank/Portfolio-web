import type { InstrumentType, Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import {
  fetchYahooMetadataBatch,
  type YahooCatalogMetadata,
} from "@/lib/market/yahoo-metadata-client";
import { mapWithConcurrency } from "@/lib/utils/concurrency";
import { planEquityProfileDrip } from "@/lib/market/equity-profile-drip-plan";

const YAHOO_SUPPORTED_TYPES = new Set<InstrumentType>(["STOCK_AR", "CEDEAR", "STOCK_US"]);
const EQUITY_PROFILE_TYPES: InstrumentType[] = ["STOCK_AR", "CEDEAR"];

/**
 * Fixed daily cap for the equity-profile drip (`enrichUnusedEquityProfiles`).
 * Independent of `ENRICH_CONCURRENCY`/`ENRICH_BUDGET_MS`: Yahoo has no known
 * daily quota (unlike Docta — see `fixed-income-linking.ts`'s
 * `DOCTA_LINKING_BUDGET_PER_RUN`), but an unbounded fan-out against ~1,687
 * STOCK_AR/CEDEAR symbols in one run is still undesirable — this is a
 * deliberate "goteo" (drip), not a whole-universe pass.
 */
export const EQUITY_PROFILE_DRIP_LIMIT = 30;

/** design §9.2. Measured (T-25): 36 distinct transaction-referenced
 * instruments — far below the ~300 revision threshold, so the constant
 * stands as designed. */
export const ENRICH_CONCURRENCY = 4;
/** Elapsed-time budget for *starting* new enrichment work; in-flight work
 * always finishes. Enrichment is best-effort — exhausting this budget just
 * means fewer instruments got enriched this run, never a failure. */
export const ENRICH_BUDGET_MS = 120_000;

export type { YahooCatalogMetadata };

/**
 * The ONLY shape an enrichment write (Yahoo, this module; Docta, C8) may
 * pass to a Prisma `instrument.update`. No `currencyCode`, `settlement`,
 * `baseInstrumentId`, `venueCode`, `ticker` or `type` key exists on this
 * type, so a future writer of any of those is a TypeScript compile error,
 * not a silent data change (AD-0, FR-14, T-37 — the structural guard R-1b's
 * mitigation depends on).
 *
 * Picked from Prisma's own update input so the allowlist cannot drift from the
 * schema: a field the column does not have fails to compile here instead of
 * throwing `Unknown argument` once per instrument at runtime. Yahoo's
 * `website` has no column and no reader, so it is discarded like its
 * `currencyCode` already is.
 */
export type EnrichmentPatch = Pick<
  Prisma.InstrumentUpdateInput,
  "name" | "isin" | "sector" | "industry" | "issuer" | "law" | "assetClass"
>;

/** The catalog symbol stays canonical. This only decides whether Yahoo applies. */
export function supportsYahooMetadata(type: InstrumentType): boolean {
  return YAHOO_SUPPORTED_TYPES.has(type);
}

/**
 * Looks up Yahoo metadata for one instrument via the HTTP adapter
 * (`fetchYahooMetadataBatch`) instead of a Python subprocess (T-18 — the
 * `execFile` caller and `scripts/yahoo_catalog.py` are deleted).
 */
export async function lookupYahooCatalogMetadata(
  symbol: string,
  type: InstrumentType
): Promise<YahooCatalogMetadata | null> {
  if (!supportsYahooMetadata(type)) return null;
  const results = await fetchYahooMetadataBatch([{ symbol, type }]);
  return results.get(symbol.trim().toUpperCase()) ?? null;
}

/**
 * Best-effort enrichment shared by catalog sync and imports. It operates only
 * on instrument rows that are actually referenced by transactions; fixed
 * income intentionally has no Yahoo request (Docta serves it instead, C8).
 *
 * AD-3 variant rule: a settlement variant (`baseInstrumentId IS NOT NULL`)
 * never stores its own `sector`/`industry` — this resolves each requested id
 * to its base first and writes descriptive metadata there instead. `name`,
 * `isin` and `website` still write on the variant's own row (they are
 * per-listing facts, not per-security facts).
 *
 * AD-0 / FR-14: currency is decided once at ingestion (catalog-sync.ts) and
 * NEVER rewritten here. Yahoo's `currencyCode` field is read and discarded.
 */
export async function enrichUsedInstruments(instrumentIds: string[]): Promise<void> {
  const ids = [...new Set(instrumentIds)];
  if (ids.length === 0) return;

  const instruments = await prisma.instrument.findMany({
    where: { id: { in: ids }, type: { in: ["STOCK_AR", "CEDEAR", "STOCK_US"] } },
    select: {
      id: true,
      ticker: true,
      type: true,
      baseInstrumentId: true,
    },
  });
  if (instruments.length === 0) return;

  await mapWithConcurrency(
    instruments,
    ENRICH_CONCURRENCY,
    async (instrument) => {
      try {
        // Yahoo's own metadata (data.currencyCode, discarded below) is read
        // for `instrument`'s own ticker — a variant's provider symbol is its
        // OWN listing (e.g. NVDAD.BA), not its base's.
        const metadata = await lookupYahooCatalogMetadata(instrument.ticker, instrument.type);
        if (!metadata) return;

        // AD-3: sector/industry land on the base row for a linked variant.
        const targetId = instrument.baseInstrumentId ?? instrument.id;

        const patch: EnrichmentPatch = {
          name: metadata.name,
          sector: metadata.sector,
          industry: metadata.industry,
        };
        // Prisma ignores `undefined` values in `data`, so omit rather than
        // write an empty string for a field Yahoo did not return.
        const data: EnrichmentPatch = Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined && v !== "")
        );

        await prisma.$transaction([
          prisma.instrument.update({ where: { id: targetId }, data }),
          prisma.instrumentProviderSymbol.upsert({
            where: {
              instrumentId_provider: { instrumentId: instrument.id, provider: metadata.provider },
            },
            create: {
              instrumentId: instrument.id,
              provider: metadata.provider,
              providerSymbol: metadata.providerSymbol,
            },
            update: { providerSymbol: metadata.providerSymbol },
          }),
        ]);
      } catch (error) {
        console.warn(
          `[yahoo-catalog] No se pudo enriquecer ${instrument.ticker}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    },
    { budgetMs: ENRICH_BUDGET_MS }
  );
}

/**
 * Capped drip enrichment for STOCK_AR/CEDEAR profile fields ONLY — never
 * bonds/notes/ON, never `PriceCache`/`MarketSnapshot`. Scoped to instruments
 * `enrichUsedInstruments` has NOT already covered this run (held instruments
 * are excluded via `heldInstrumentIds`, avoiding a duplicate fetch) and that
 * have never been attempted before (`profileEnrichedAt IS NULL` — an
 * explicit marker, not inferred from `name === ticker`, which would
 * false-positive whenever a real ticker's name happens to equal its symbol).
 * `profileEnrichedAt` is set on every attempt, success or not, so a ticker
 * Yahoo has no data for is not retried every single run forever.
 */
export async function enrichUnusedEquityProfiles(
  heldInstrumentIds: string[],
  limit: number = EQUITY_PROFILE_DRIP_LIMIT
): Promise<void> {
  const heldIds = new Set(heldInstrumentIds);

  const candidates = await prisma.instrument.findMany({
    where: { type: { in: EQUITY_PROFILE_TYPES }, profileEnrichedAt: null },
    select: { id: true, ticker: true, type: true, baseInstrumentId: true },
  });
  if (candidates.length === 0) return;

  const plan = planEquityProfileDrip(
    candidates.map((c) => ({ ticker: c.ticker, isHeld: heldIds.has(c.id) })),
    limit
  );
  const byTicker = new Map(candidates.map((c) => [c.ticker, c]));
  const toAttempt = plan.flatMap((p) => (byTicker.has(p.ticker) ? [byTicker.get(p.ticker)!] : []));

  await mapWithConcurrency(
    toAttempt,
    ENRICH_CONCURRENCY,
    async (instrument) => {
      try {
        const metadata = await lookupYahooCatalogMetadata(instrument.ticker, instrument.type);
        const targetId = instrument.baseInstrumentId ?? instrument.id;

        const patch: EnrichmentPatch = metadata
          ? {
              name: metadata.name,
              sector: metadata.sector,
              industry: metadata.industry,
            }
          : {};
        const data: EnrichmentPatch = Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined && v !== "")
        );

        await prisma.$transaction([
          prisma.instrument.update({ where: { id: targetId }, data }),
          prisma.instrument.update({
            where: { id: instrument.id },
            data: { profileEnrichedAt: new Date() },
          }),
        ]);
      } catch (error) {
        console.warn(
          `[yahoo-catalog] Drip: no se pudo enriquecer ${instrument.ticker}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    },
    { budgetMs: ENRICH_BUDGET_MS }
  );
}
