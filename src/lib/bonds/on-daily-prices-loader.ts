import { prisma } from "@/lib/prisma";
import type { OnSnapshotRow, OnTermsRow } from "./on-daily-prices";

/**
 * Insumos de `buildOnDailyPrices` para un set de ONs: snapshots de data912 (ARS por
 * 100 VN) y términos/schedule. Orquestador de Prisma, sin tests a propósito.
 */
export async function loadOnPriceInputs(
  instrumentIds: string[]
): Promise<{ snapshotRows: OnSnapshotRow[]; termsRows: OnTermsRow[] }> {
  if (instrumentIds.length === 0) return { snapshotRows: [], termsRows: [] };

  const [snapshotRows, termsRows] = await Promise.all([
    prisma.priceCache.findMany({
      where: { instrumentId: { in: instrumentIds }, source: "data912" },
      orderBy: { datetime: "asc" },
      select: { instrumentId: true, datetime: true, close: true },
    }),
    prisma.instrument.findMany({
      where: { id: { in: instrumentIds } },
      select: { id: true, bondTerms: true, bondSchedule: true },
    }),
  ]);

  return { snapshotRows, termsRows };
}
