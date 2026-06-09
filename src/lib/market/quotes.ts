import { Prisma, type InstrumentType } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { buildYahooSymbol, fetchYahooQuote } from "./yahoo";

const ARGENTINIAN_TYPES = new Set<InstrumentType>([
  "CEDEAR",
  "STOCK_AR",
  "BOND_AR",
  "LETRA",
  "ON",
]);

/** Considera "fresco" todo precio con menos de 10 minutos. */
const FRESH_PRICE_MS = 10 * 60 * 1000;

export type InstrumentForQuote = {
  id: string;
  ticker: string;
  type: InstrumentType;
};

export type RefreshQuotesResult = {
  prices: Map<string, string>;
  errors: string[];
};

/**
 * Para cada instrumento devuelve su último precio en moneda nativa del ticker
 * (ARS para CEDEAR/STOCK_AR vía Yahoo .BA, USD para STOCK_US/ETF).
 *
 * Usa PriceCache si hay un valor reciente; si no, pega a Yahoo, guarda
 * el nuevo precio y lo devuelve. Falla silenciosa por ticker para no
 * romper la página entera.
 */
export async function refreshLatestQuotes(
  instruments: InstrumentForQuote[]
): Promise<RefreshQuotesResult> {
  const prices = new Map<string, string>();
  const errors: string[] = [];
  if (instruments.length === 0) return { prices, errors };

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
    if (hit && now - hit.datetime.getTime() < FRESH_PRICE_MS) {
      prices.set(inst.id, hit.close.toString());
    } else {
      toFetch.push(inst);
    }
  }

  await Promise.all(
    toFetch.map(async (inst) => {
      const symbol = buildYahooSymbol(inst.ticker, ARGENTINIAN_TYPES.has(inst.type));
      try {
        const quote = await fetchYahooQuote(symbol);
        prices.set(inst.id, quote.price.toString());
        const datetime = quote.asOf ? new Date(quote.asOf * 1000) : new Date();
        await prisma.priceCache.upsert({
          where: {
            instrumentId_datetime_source: {
              instrumentId: inst.id,
              datetime,
              source: "yahoo",
            },
          },
          create: {
            instrumentId: inst.id,
            datetime,
            close: new Prisma.Decimal(quote.price),
            source: "yahoo",
          },
          update: {
            close: new Prisma.Decimal(quote.price),
          },
        });
      } catch (err) {
        const cachedClose = cachedById.get(inst.id);
        if (cachedClose) {
          prices.set(inst.id, cachedClose.close.toString());
        }
        errors.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );

  return { prices, errors };
}
