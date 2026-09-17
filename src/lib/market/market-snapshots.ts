import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchData912Live, type CatalogInstrument } from "./data912-universe";

/**
 * Persist only the latest market state per instrument; no historical rows.
 *
 * AD-10: consumes the shared `fetchData912Live` reader instead of its own
 * fetch. `rows` may be supplied by the caller (the sync pipeline, §5.1 step
 * 2, which already fetched them at step 1 with `cache: "no-store"` — passing
 * them here avoids a second data912 hit) or omitted, in which case this
 * function fetches them itself (this module's only other/standalone use).
 */
export async function syncLatestData912Snapshots(rows?: CatalogInstrument[]): Promise<number> {
  const asOf = new Date();
  const snapshots = rows ?? (await fetchData912Live({}));
  if (snapshots.length === 0) return 0;

  const instruments = await prisma.instrument.findMany({
    where: { active: true, ticker: { in: [...new Set(snapshots.map((s) => s.ticker))] } },
    select: { id: true, ticker: true, type: true },
  });
  // Matches on ticker+type against every venue/currency variant currently
  // active for that pair — a data912 row carries no venue/currency of its
  // own. Unchanged behavior from the prior hand-rolled `ticker|type` map;
  // `instrumentKey` (AD-2) is not applicable here since it requires
  // venueCode/currencyCode, which this reconciliation does not have.
  const byTickerType = new Map(instruments.map((i) => [`${i.ticker}|${i.type}`, i]));

  let saved = 0;
  await Promise.all(
    snapshots.map(async (snapshot) => {
      const instrument = byTickerType.get(`${snapshot.ticker}|${snapshot.type}`);
      if (!instrument) return;
      const data = {
        source: "data912",
        asOf,
        price: snapshot.price === null ? null : new Prisma.Decimal(snapshot.price),
        pctChange: snapshot.pctChange === null ? null : new Prisma.Decimal(snapshot.pctChange),
        volume: snapshot.volume === null ? null : new Prisma.Decimal(snapshot.volume),
        bidQuantity: snapshot.bidQuantity === null ? null : new Prisma.Decimal(snapshot.bidQuantity),
        bidPrice: snapshot.bidPrice === null ? null : new Prisma.Decimal(snapshot.bidPrice),
        askPrice: snapshot.askPrice === null ? null : new Prisma.Decimal(snapshot.askPrice),
        askQuantity: snapshot.askQuantity === null ? null : new Prisma.Decimal(snapshot.askQuantity),
        openInterest: snapshot.openInterest === null ? null : new Prisma.Decimal(snapshot.openInterest),
      };
      await prisma.marketSnapshot.upsert({
        where: { instrumentId: instrument.id },
        create: { instrumentId: instrument.id, ...data },
        update: data,
      });
      saved += 1;
    })
  );
  return saved;
}
