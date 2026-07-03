/**
 * Persisted CCL (USD/ARS) rate for USD-denominated dashboard metrics.
 *
 * The dashboard reads a stored FxRate rather than a live quote. This resolver
 * seeds/refreshes that store from dolarapi at most once per UTC day: if the most
 * recent USD/ARS FxRate is missing or from a previous day, it fetches the CCL
 * quote and upserts a CCL-source row keyed on today's date. It is NOT real-time
 * — one lazy refresh per day, and dolarapi itself is fetch-cached for 15 min.
 *
 * On dolarapi failure it falls back to the last stored rate (however old), so a
 * transient outage never blanks out the USD view once a rate has been seeded.
 */

import { Prisma } from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { fetchCclQuote } from "./dolarapi";

/** UTC midnight of the current day — the stable key for the daily FxRate row. */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Return the current USD→ARS CCL mid rate, seeding it from dolarapi if the
 * store has no fresh value. Returns null only when there is no stored rate AND
 * dolarapi is unavailable.
 */
export async function resolveCclRate(): Promise<number | null> {
  const latest = await prisma.fxRate.findFirst({
    where: { baseCurrencyCode: "USD", quoteCurrencyCode: "ARS" },
    orderBy: { date: "desc" },
  });

  const today = todayUtc();

  // A rate dated today already covers this session — no refetch.
  if (latest && latest.date.getTime() >= today.getTime()) {
    return Number(latest.mid);
  }

  const quote = await fetchCclQuote();
  if (!quote) {
    // dolarapi unavailable: fall back to the last stored rate, however old.
    return latest ? Number(latest.mid) : null;
  }

  try {
    await prisma.fxRate.upsert({
      where: {
        date_baseCurrencyCode_quoteCurrencyCode_source: {
          date: today,
          baseCurrencyCode: "USD",
          quoteCurrencyCode: "ARS",
          source: "CCL",
        },
      },
      create: {
        date: today,
        baseCurrencyCode: "USD",
        quoteCurrencyCode: "ARS",
        source: "CCL",
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
  } catch {
    // Persistence failure (e.g. missing Currency row) is non-fatal — still use
    // the freshly fetched mid so the USD view renders this session.
  }

  return quote.mid;
}
