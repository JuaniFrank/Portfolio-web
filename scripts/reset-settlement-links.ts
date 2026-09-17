/**
 * Manual escape hatch for a bad settlement link (design AD-5, T-43).
 *
 * Links are monotonic by design (AD-5): a sync never revokes a confirmed
 * `baseInstrumentId`/`settlement` just because a run failed to re-confirm
 * it — that is what protects a held position's valuation against a thin
 * trading day. But monotonicity also means a *wrong* link is permanent
 * until explicitly reset. This script is that reset.
 *
 * Plain `tsx` script — not a route, not a cron, no server action, no UI.
 * The next `sync-catalog` run re-derives every reset link from scratch.
 *
 * Usage:
 *   npx tsx scripts/reset-settlement-links.ts                # reset every linked instrument
 *   npx tsx scripts/reset-settlement-links.ts NVDAD NVDAC     # reset only these tickers
 */

import { prisma } from "../src/lib/prisma";

async function main() {
  const tickers = process.argv.slice(2);
  const tickerFilter = tickers.length > 0 ? tickers.map((t) => t.trim().toUpperCase()) : null;

  const result = await prisma.$executeRawUnsafe(
    `UPDATE "Instrument"
        SET "baseInstrumentId" = NULL, "settlement" = 'ARS', "currencyCode" = 'ARS'
      WHERE "baseInstrumentId" IS NOT NULL
        AND ($1::text[] IS NULL OR "ticker" = ANY($1));`,
    tickerFilter
  );

  console.log(
    tickerFilter
      ? `Reset ${result} instrument(s) matching [${tickerFilter.join(", ")}] to unlinked/ARS.`
      : `Reset ${result} instrument(s) to unlinked/ARS (every linked instrument).`
  );
  console.log("Run the sync-catalog cron (or trigger it manually) to re-derive links.");
}

main()
  .catch((error) => {
    console.error("reset-settlement-links failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
