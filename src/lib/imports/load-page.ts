import { getCurrentUser } from "@/lib/auth";
import type { ImportedTransactionRow } from "@/lib/imports/filters";
import { prisma } from "@/lib/prisma";
import { TransactionSource } from "@/lib/generated/prisma";

export type ImportContextData = {
  brokers: Array<{ id: string; code: string; name: string; enabled: boolean }>;
  portfolios: Array<{ id: string; name: string; isDefault: boolean }>;
  brokerAccounts: Array<{
    id: string;
    name: string;
    brokerId: string;
    currencyCode: string;
    broker: { code: string; name: string };
  }>;
};

export async function loadImportContext(): Promise<
  ImportContextData | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const [brokers, portfolios, brokerAccounts] = await Promise.all([
    prisma.broker.findMany({ orderBy: { name: "asc" } }),
    prisma.portfolio.findMany({
      where: { userId: user.id, archivedAt: null },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isDefault: true },
    }),
    prisma.brokerAccount.findMany({
      where: { userId: user.id, archivedAt: null },
      orderBy: { name: "asc" },
      include: { broker: { select: { code: true, name: true } } },
    }),
  ]);

  return { brokers, portfolios, brokerAccounts };
}

// ---------------------------------------------------------------------------
// Listado y borrado de transacciones importadas
// ---------------------------------------------------------------------------

export async function loadImportedTransactions(): Promise<
  ImportedTransactionRow[] | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const rows = await prisma.transaction.findMany({
    where: {
      source: TransactionSource.IMPORT,
      portfolio: { userId: user.id },
    },
    orderBy: { tradeDate: "desc" },
    include: {
      instrument: { select: { ticker: true, type: true } },
      importBatch: {
        select: {
          id: true,
          fileName: true,
          broker: { select: { name: true } },
        },
      },
    },
  });

  return rows
    .filter((r) => r.importBatch)
    .map((r) => ({
      id: r.id,
      tradeDate: r.tradeDate.toISOString(),
      type: r.type,
      ticker: r.instrument?.ticker ?? null,
      instrumentType: r.instrument?.type ?? null,
      quantity: r.quantity.toString(),
      netAmount: r.netAmount.toString(),
      currencyCode: r.currencyCode,
      notes: r.notes,
      brokerName: r.importBatch!.broker.name,
      fileName: r.importBatch!.fileName,
      importBatchId: r.importBatch!.id,
    }));
}
