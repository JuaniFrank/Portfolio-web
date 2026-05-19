"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { commitImportBatch, ensureDefaultImportTargets } from "@/lib/importers/commit-import";
import type { ImportedTransactionRow } from "@/lib/imports/filters";
import { prisma } from "@/lib/prisma";
import { TransactionSource } from "@/lib/generated/prisma";
import type { CommitImportRow } from "@/lib/importers/types";

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

export async function getImportContextAction(): Promise<
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

export type CommitImportActionInput = {
  brokerCode: string;
  fileName: string;
  fileHash: string;
  portfolioId?: string;
  brokerAccountId?: string;
  rows: CommitImportRow[];
};

export type CommitImportActionResult =
  | { ok: true; importBatchId: string; imported: number; skipped: number }
  | { ok: false; error: string };

export async function commitImportAction(
  input: CommitImportActionInput
): Promise<CommitImportActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "No autenticado" };

  const broker = await prisma.broker.findUnique({
    where: { code: input.brokerCode },
  });
  if (!broker?.enabled) {
    return { ok: false, error: "Broker no habilitado" };
  }

  let portfolioId = input.portfolioId;
  let brokerAccountId = input.brokerAccountId;

  if (!portfolioId || !brokerAccountId) {
    const defaults = await ensureDefaultImportTargets(user.id, broker.id);
    portfolioId = defaults.portfolio.id;
    brokerAccountId = defaults.account.id;
  }

  const result = await commitImportBatch({
    userId: user.id,
    brokerId: broker.id,
    brokerAccountId,
    portfolioId,
    fileName: input.fileName,
    fileHash: input.fileHash,
    rows: input.rows,
  });

  if (result.ok) {
    revalidatePath("/imports");
    revalidatePath("/transactions");
  }

  return result;
}

export async function getImportedTransactionsAction(): Promise<
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
