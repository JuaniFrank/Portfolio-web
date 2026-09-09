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
 *
 * Finnhub lookups are rate-limited (FINNHUB_BATCH_SIZE every
 * FINNHUB_BATCH_DELAY_MS) and persisted batch-by-batch as they resolve. If a
 * later batch (or the DB) fails, whatever was already created stays
 * committed — the next run recomputes "toCreate" against the DB and only
 * asks Finnhub for what's still missing, instead of redoing the whole wait.
 */

import { InstrumentType } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchInstrumentUniverse, type CatalogInstrument } from "./data912-universe";
import { CURATED_INSTRUMENT_NAMES, displayNameFor } from "./instrument-names";

const CATALOG_TYPES: InstrumentType[] = [
  InstrumentType.STOCK_AR,
  InstrumentType.CEDEAR,
  InstrumentType.ON,
  InstrumentType.STOCK_US
];

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;

// Finnhub free tier: 30 req/s. Lo dejamos en 25 cada 5s para tener margen y
// no pisar otros consumidores del mismo token.
const FINNHUB_BATCH_SIZE = 28;
const FINNHUB_BATCH_DELAY_MS = 30100;

const LOG_PREFIX = "[catalog-sync]";

function identityKey(i: {
  ticker: string;
  type: InstrumentType;
  // currencyCode: string;
  // venueCode: string | null;
}): string {
  // return `${i.ticker}|${i.type}|${i.currencyCode}|${i.venueCode ?? ""}`;
  return `${i.ticker}|${i.type} ?? ""}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  error?: string;
};

export type TickerInfo = {
  ticker?: string;
  name?: string;
  country?: string;
  currency?: string;
  estimateCurrency?: string;
  exchange?: string;
  ipo?: string;
  marketCapitalization?: number;
  logo?: string;
  shareOutstanding?: number;
  finnhubIndustry?: string;
  phone?: string;
  weburl?: string;
  floatingShare?: number;
  error?: string;
};

/**
 * Best-effort lookup of the display name from Finnhub. Never throws: if the
 * key is missing, the request fails, or Finnhub rate-limits us, we just fall
 * back to the curated/ticker name so a flaky third party can't block creates.
 */
async function lookupFinnhubData(ticker: string): Promise<TickerInfo | undefined> {
  // if (!FINNHUB_API_KEY) return { error: "key missing" };

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(ticker)}&token=da68vp9r01qtngrevq70da68vp9r01qtngrevq7g`
    );
    if (!res.ok) {
      console.warn(`${LOG_PREFIX} Finnhub respondió ${res.status} para ${ticker}`);
      return undefined;
    }

    const tickerInfo: TickerInfo = await res.json();
    return tickerInfo;
  } catch (err) {
    console.warn(`${LOG_PREFIX} Error consultando Finnhub para ${ticker}: ${errorMessage(err)}`);
    return undefined;
  }
}

export async function syncInstrumentCatalog(): Promise<CatalogSyncResult> {
  const startedAt = Date.now();
  const errors: string[] = [];

  console.log(`${LOG_PREFIX} Iniciando sync de catálogo de instrumentos...`);

  let universe: CatalogInstrument[];
  try {
    universe = await fetchInstrumentUniverse();
  } catch (err) {
    const message = errorMessage(err);
    console.error(`${LOG_PREFIX} Error obteniendo universo de data912: ${message}`);
    return {
      ok: false,
      fetched: 0,
      created: 0,
      reactivated: 0,
      delisted: 0,
      renamed: 0,
      error: message,
    };
  }

  console.log(`${LOG_PREFIX} Universo obtenido de data912: ${universe.length} instrumentos`);

  // Guard: an empty universe means every endpoint failed. Bailing out here is
  // what prevents a transient data912 outage from delisting the whole catalog.
  if (universe.length === 0) {
    const message = "Universo vacío — no se tocó el catálogo (probable caída de data912)";
    console.error(`${LOG_PREFIX} ${message}`);
    return {
      ok: false,
      fetched: 0,
      created: 0,
      reactivated: 0,
      delisted: 0,
      renamed: 0,
      error: message,
    };
  }

  const wanted = new Map<string, CatalogInstrument>();
  for (const i of universe) wanted.set(identityKey(i), i);

  const existing = await prisma.instrument.findMany({
    where: { type: { in: CATALOG_TYPES } },
    select: { id: true, ticker: true, type: true, currencyCode: true, venueCode: true, active: true },
  });
  console.log(`${LOG_PREFIX} ${existing.length} instrumentos existentes en la DB para los tipos del catálogo`);
  const existingByKey = new Map(existing.map((e) => [identityKey(e), e]));

  // --- Creates ---
  // Ya excluye lo que está guardado en la DB: si una corrida anterior se
  // cortó a mitad de camino, los tickers de los batches que sí llegaron a
  // persistirse no vuelven a pedirse acá.
  const toCreate = [...wanted.values()].filter((i) => !existingByKey.has(identityKey(i)));
  console.log(`${LOG_PREFIX} ${toCreate.length} instrumentos nuevos a crear (excluye lo ya guardado en la DB)`);

  // Consultamos monedas y venues válidos en la DB para garantizar integridad referencial
  const dbCurrencies = new Set(
    (await prisma.currency.findMany({ select: { code: true } })).map((c) => c.code)
  );
  const dbVenues = new Set(
    (await prisma.venue.findMany({ select: { code: true } })).map((v) => v.code)
  );

  const resolveVenueCode = (i: CatalogInstrument, finnhubData?: TickerInfo): string | null => {
    if (i.type === "STOCK_AR" || i.type === "ON" || i.type === "CEDEAR") {
      return dbVenues.has("BYMA") ? "BYMA" : null;
    }
    const exchange = finnhubData?.exchange?.toUpperCase() ?? "";
    if (exchange.includes("NASDAQ") && dbVenues.has("NASDAQ")) return "NASDAQ";
    if ((exchange.includes("NEW YORK") || exchange.includes("NYSE")) && dbVenues.has("NYSE")) return "NYSE";
    if ((exchange.includes("AMEX") || exchange.includes("AMERICAN")) && dbVenues.has("AMEX")) return "AMEX";
    if (exchange.includes("CBOE") && dbVenues.has("CBOE")) return "CBOE";
    if (exchange.includes("B3") && dbVenues.has("B3")) return "B3";
    if (exchange.includes("LONDON") && dbVenues.has("LSE")) return "LSE";
    return null;
  };

  const resolveTaxJurisdiction = (i: CatalogInstrument, finnhubData?: TickerInfo): string => {
    if (finnhubData?.country) {
      const code = finnhubData.country.trim().toUpperCase();
      if (code.length > 0) return code;
    }
    switch (i.type) {
      case "STOCK_AR":
      case "ON":
        return "AR";
      case "STOCK_US":
      case "CEDEAR":
        return "US";
      default:
        return "AR";
    }
  };

  const resolveCurrencyCode = (i: CatalogInstrument, finnhubData?: TickerInfo): string => {
    const rawCurrency = finnhubData?.currency?.trim().toUpperCase();
    if (rawCurrency && dbCurrencies.has(rawCurrency)) {
      return rawCurrency;
    }
    const fallback = i.type === "STOCK_US" ? "USD" : "ARS";
    if (dbCurrencies.has(fallback)) {
      return fallback;
    }
    return [...dbCurrencies][0] ?? "ARS";
  };

  let created = 0;

  if (toCreate.length > 0) {
    const batches = chunk(toCreate, FINNHUB_BATCH_SIZE);
    console.log(
      `${LOG_PREFIX} Procesando ${toCreate.length} tickers en ${batches.length} batch(es) de hasta ${FINNHUB_BATCH_SIZE}, con ${FINNHUB_BATCH_DELAY_MS}ms de espera entre batches`
    );

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      console.log(`${LOG_PREFIX} Batch ${b + 1}/${batches.length}: consultando Finnhub (${batch?.length ?? 0} tickers)...`);

      const batchResults = await Promise.all(
        batch && batch.length > 0 ? batch.map(async (i) => {
          const finnhubData = await lookupFinnhubData(i.ticker);
          const name = finnhubData?.name ?? finnhubData?.error;
          return {
            ticker: i.ticker,
            name: name || i.ticker,
            type: i.type,
            venueCode: resolveVenueCode(i, finnhubData),
            currencyCode: resolveCurrencyCode(i, finnhubData),
            taxJurisdiction: resolveTaxJurisdiction(i, finnhubData),
            active: true,
          };
        }) : []
      );

      // Guardamos el batch apenas se resuelve, no todo junto al final: si
      // Finnhub o la DB fallan más adelante (o se corta el proceso), lo de
      // este batch ya queda persistido y no hay que volver a esperar por eso.
      try {
        const res = await prisma.instrument.createMany({
          data: batchResults,
          skipDuplicates: true,
        });
        created += res.count;
        console.log(
          `${LOG_PREFIX} Batch ${b + 1}/${batches.length}: ${res.count} creados (acumulado ${created}/${toCreate.length})`
        );
      } catch (err) {
        const message = errorMessage(err);
        console.error(`${LOG_PREFIX} Batch ${b + 1}/${batches.length}: error guardando en la DB — ${message}`);

        // --- DEBUG CURRENCIES ---
        try {
          const dbCurrencies = new Set(
            (await prisma.currency.findMany({ select: { code: true } })).map((c) => c.code)
          );
          console.error(`${LOG_PREFIX} [DEBUG] Monedas existentes en la tabla Currency (${dbCurrencies.size}):`, [...dbCurrencies]);
          
          const batchCurrencies = [...new Set(batchResults.map((r) => r.currencyCode))];
          console.error(`${LOG_PREFIX} [DEBUG] Monedas presentes en este batch:`, batchCurrencies);

          const invalidItems = batchResults.filter((r) => !dbCurrencies.has(r.currencyCode));
          console.error(
            `${LOG_PREFIX} [DEBUG] ${invalidItems.length} items con currencyCode que NO existe en la DB:`,
            invalidItems.map((item) => ({ ticker: item.ticker, type: item.type, currencyCode: item.currencyCode }))
          );
        } catch (debugErr) {
          console.error(`${LOG_PREFIX} [DEBUG] Error obteniendo monedas para diagnóstico:`, debugErr);
        }
        // ------------------------

        errors.push(`create batch ${b + 1}/${batches.length}: ${message}`);
        break; // lo de batches previos ya está persistido, no seguimos pidiendo de más
      }

      const isLastBatch = b === batches.length - 1;
      if (!isLastBatch) {
        console.log(`${LOG_PREFIX} Esperando ${FINNHUB_BATCH_DELAY_MS}ms antes del próximo batch...`);
        await sleep(FINNHUB_BATCH_DELAY_MS);
      }
    }
  }

  // --- Reactivations (previously soft-delisted, now listed again) ---
  const toReactivate = existing
    .filter((e) => !e.active && wanted.has(identityKey(e)))
    .map((e) => e.id);
  let reactivated = 0;
  if (toReactivate.length > 0) {
    console.log(`${LOG_PREFIX} Reactivando ${toReactivate.length} instrumentos...`);
    try {
      const res = await prisma.instrument.updateMany({
        where: { id: { in: toReactivate } },
        data: { active: true },
      });
      reactivated = res.count;
      console.log(`${LOG_PREFIX} ${reactivated} instrumentos reactivados`);
    } catch (err) {
      const message = errorMessage(err);
      console.error(`${LOG_PREFIX} Error reactivando instrumentos: ${message}`);
      errors.push(`reactivate: ${message}`);
    }
  }

  // --- Soft delists (listed before, gone now) ---
  const toDelist = existing
    .filter((e) => e.active && !wanted.has(identityKey(e)))
    .map((e) => e.id);
  let delisted = 0;
  if (toDelist.length > 0) {
    console.log(`${LOG_PREFIX} Dando de baja (soft) ${toDelist.length} instrumentos...`);
    try {
      const res = await prisma.instrument.updateMany({
        where: { id: { in: toDelist } },
        data: { active: false },
      });
      delisted = res.count;
      console.log(`${LOG_PREFIX} ${delisted} instrumentos dados de baja`);
    } catch (err) {
      const message = errorMessage(err);
      console.error(`${LOG_PREFIX} Error dando de baja instrumentos: ${message}`);
      errors.push(`delist: ${message}`);
    }
  }

  // --- Name enrichment: backfill curated names onto rows still named as their
  // ticker. Bounded by the curated map (~dozens), one update per entry. ---
  // let renamed = 0;
  // for (const [ticker, name] of Object.entries(CURATED_INSTRUMENT_NAMES)) {
  //   const res = await prisma.instrument.updateMany({
  //     where: { ticker, type: { in: CATALOG_TYPES }, venueCode: "BYMA", name: ticker },
  //     data: { name },
  //   });
  //   renamed += res.count;
  // }

  const ok = errors.length === 0;
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `${LOG_PREFIX} Sync ${ok ? "completado" : "completado con errores"} en ${elapsedSec}s — fetched=${universe.length} created=${created} reactivated=${reactivated} delisted=${delisted}`
  );

  return {
    ok,
    fetched: universe.length,
    created,
    reactivated,
    delisted,
    renamed: 0,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}