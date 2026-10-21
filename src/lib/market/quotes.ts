import { Prisma, type InstrumentType, type Settlement } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { resolveCclRate } from "./ccl-rate";
import { resolveMonitoringRouting } from "./provider-routing";
import { isQuoteFresh } from "./quote-freshness";
import { fetchYahooQuote } from "./yahoo";

/** Tipos que cotizan en BYMA y por lo tanto llevan sufijo `.BA` en Yahoo.
 * Kept for other callers (history-sync.ts, forecast.ts); `refreshLatestQuotes`
 * itself now resolves its symbol via `resolveMonitoringRouting` (T-30/T-35,
 * AD-6) instead of this inline check. */
export const ARGENTINIAN_TYPES = new Set<InstrumentType>([
  "CEDEAR",
  "STOCK_AR",
  "BOND_AR",
  "LETRA",
  "ON",
]);

export type InstrumentForQuote = {
  id: string;
  ticker: string;
  type: InstrumentType;
  /** Currency-aware routing (AD-6). Optional for backward compatibility with
   * callers that only quote already-ARS-native instruments; defaults applied
   * below make such a call behave exactly as before this change. */
  currencyCode?: string;
  settlement?: Settlement;
  baseInstrument?: { ticker: string } | null;
};

export type RefreshQuotesResult = {
  prices: Map<string, string>;
  errors: string[];
  /** Ids de los instrumentos cuyo fetch en vivo falló (con o sin precio de respaldo en caché). */
  failedIds: string[];
};

/**
 * Para cada instrumento devuelve su último precio en ARS.
 *
 * Usa PriceCache si hay un valor reciente; si no, resuelve el símbolo/moneda
 * vía `resolveMonitoringRouting(inst, "spot")` (AD-6): un variante linkeado
 * cotiza contra el símbolo `.BA` de su base; el resultado se convierte a ARS
 * cuando la moneda resuelta es USD, vía la misma `resolveCclRate()` que ya
 * usa la rama ON. `PriceCache` permanece siempre en ARS — su semántica no
 * cambia. Falla silenciosa por ticker para no romper la página entera.
 */
export async function refreshLatestQuotes(
  instruments: InstrumentForQuote[]
): Promise<RefreshQuotesResult> {
  const prices = new Map<string, string>();
  const errors: string[] = [];
  const failedIds: string[] = [];
  if (instruments.length === 0) return { prices, errors, failedIds };

  const ids = instruments.map((i) => i.id);
  const cached = await prisma.priceCache.findMany({
    where: { instrumentId: { in: ids }, source: "yahoo" },
    orderBy: { datetime: "desc" },
    distinct: ["instrumentId"],
    select: { instrumentId: true, close: true, datetime: true },
  });

  const cachedById = new Map(cached.map((c) => [c.instrumentId, c]));
  const now = Date.now();
  const toFetch: InstrumentForQuote[] = [];

  for (const inst of instruments) {
    const hit = cachedById.get(inst.id);
    // `datetime` of a "yahoo" row is its FETCH time (see the write below), so a quote
    // fetched after the close stays fresh instead of being refetched on every render.
    if (hit && isQuoteFresh(hit.datetime, now)) {
      prices.set(inst.id, hit.close.toString());
    } else {
      toFetch.push(inst);
    }
  }

  if (toFetch.length === 0) return { prices, errors, failedIds };

  // Resolved lazily, once, only if a USD-routed instrument actually needs it.
  let cclRatePromise: Promise<number | null> | null = null;
  const resolveCcl = () => (cclRatePromise ??= resolveCclRate());

  await Promise.all(
    toFetch.map(async (inst) => {
      const routing = resolveMonitoringRouting(
        {
          id: inst.id,
          ticker: inst.ticker,
          type: inst.type,
          currencyCode: inst.currencyCode ?? "ARS",
          settlement: inst.settlement ?? "ARS",
          baseInstrument: inst.baseInstrument ?? null,
        },
        "spot"
      );
      const symbol = routing.externalSymbol;

      try {
        const quote = await fetchYahooQuote(symbol);
        let priceArs = quote.price;
        if (routing.currency === "USD") {
          const cclRate = await resolveCcl();
          if (!cclRate || cclRate <= 0) {
            throw new Error("CCL rate unavailable for USD-routed quote conversion");
          }
          priceArs = quote.price * cclRate;
        }

        prices.set(inst.id, priceArs.toString());
        // Fetch time, not `quote.asOf` (last trade): the cache has no separate fetched-at
        // column and freshness must not depend on whether the market is open. Only this
        // function reads/writes source "yahoo"; EOD history uses its own sources.
        const datetime = new Date();
        await prisma.$transaction([
          prisma.priceCache.create({
            data: {
              instrumentId: inst.id,
              datetime,
              close: new Prisma.Decimal(priceArs),
              source: "yahoo",
            },
          }),
          // One live row per instrument: every refresh has a new `datetime`, so drop the old ones.
          prisma.priceCache.deleteMany({
            where: { instrumentId: inst.id, source: "yahoo", datetime: { lt: datetime } },
          }),
        ]);
      } catch (err) {
        const cachedClose = cachedById.get(inst.id);
        if (cachedClose) {
          prices.set(inst.id, cachedClose.close.toString());
        }
        failedIds.push(inst.id);
        errors.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  return { prices, errors, failedIds };
}
