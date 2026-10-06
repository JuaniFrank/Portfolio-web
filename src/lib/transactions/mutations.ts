import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import { batchStateAfterDelete } from "@/lib/transactions/delete-helpers";

/**
 * Every screen that reads `Transaction`. Any write to transactions (import,
 * create, edit, delete) must invalidate all of them: if you add a screen that
 * derives data from transactions, add it here.
 */
const TRANSACTION_CONSUMER_PATHS = [
  "/imports",
  "/transactions",
  "/dashboard",
  "/rendimientos",
  "/dividends",
  "/bonds",
  "/events",
  "/monitoreo",
] as const;

export function revalidateTransactionConsumers() {
  for (const path of TRANSACTION_CONSUMER_PATHS) revalidatePath(path);
}

/**
 * Deletes the transactions matching `where` that belong to `userId`'s
 * portfolios, then re-derives `rowsImported`/`status` of every import batch
 * they came from (an emptied batch becomes REVERTED). One DB transaction, so a
 * failure leaves nothing half-deleted. Ownership is enforced here, not by the
 * caller: `where` can never reach another user's rows.
 *
 * Never touches Instrument or market data (shared, global).
 */
export async function deleteOwnedTransactions(
  userId: string,
  where: Prisma.TransactionWhereInput
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const owned = await tx.transaction.findMany({
      where: { AND: [where, { portfolio: { userId } }] },
      select: { id: true, importBatchId: true },
    });
    if (owned.length === 0) return 0;

    const batchIds = [
      ...new Set(owned.map((t) => t.importBatchId).filter((v): v is string => Boolean(v))),
    ];
    const res = await tx.transaction.deleteMany({
      where: { id: { in: owned.map((t) => t.id) } },
    });

    for (const batchId of batchIds) {
      const remaining = await tx.transaction.count({ where: { importBatchId: batchId } });
      await tx.importBatch.update({
        where: { id: batchId },
        data: batchStateAfterDelete(remaining),
      });
    }

    return res.count;
  });
}
