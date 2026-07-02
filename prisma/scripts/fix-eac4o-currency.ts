/**
 * Data-correction script: fix ON purchase rows whose currencyCode was incorrectly
 * imported as ARS instead of USD.
 *
 * Scope: Transaction rows where:
 *   - instrument.ticker = "EAC4O"
 *   - instrument.type   = ON
 *   - currencyCode      = "ARS"
 *
 * Safe to run multiple times — idempotent (second run → 0 rows affected, no error).
 *
 * Usage:
 *   npx tsx prisma/scripts/fix-eac4o-currency.ts
 */

import { PrismaClient } from "../../src/lib/generated/prisma";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const result = await prisma.transaction.updateMany({
    where: {
      instrument: {
        ticker: "EAC4O",
        type: "ON",
      },
      currencyCode: "ARS",
    },
    data: {
      currencyCode: "USD",
    },
  });

  console.log(`fix-eac4o-currency: ${result.count} row(s) updated.`);
  if (result.count === 0) {
    console.log("Nothing to fix — either no EAC4O rows exist, or all are already USD.");
  }
}

main()
  .catch((err) => {
    console.error("fix-eac4o-currency failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
