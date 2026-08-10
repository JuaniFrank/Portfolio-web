"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import {
  commitImportBatch,
  ensureDefaultImportTargets,
  findDefaultImportTargets,
} from "@/lib/importers/commit-import";
import {
  toDuplicateRow,
  type DuplicateBatch,
  type DuplicateCheckResult,
  type DuplicateRow,
} from "@/lib/importers/duplicates";
import { buildImportIdempotencyHash } from "@/lib/importers/idempotency";
import type { ImportedTransactionRow } from "@/lib/imports/filters";
import { prisma } from "@/lib/prisma";
import { ImportStatus, TransactionSource } from "@/lib/generated/prisma";
import type { CommitImportRow, DuplicateStrategy } from "@/lib/importers/types";

/** Tope defensivo para las operaciones masivas disparadas desde el cliente. */
const MAX_BULK_IDS = 2000;

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

// ---------------------------------------------------------------------------
// Detección de duplicados (corre ANTES del commit)
// ---------------------------------------------------------------------------

export type CheckImportDuplicatesInput = {
  brokerCode: string;
  fileHash: string;
  brokerAccountId?: string;
  rows: CommitImportRow[];
};

/**
 * Detecta si el archivo o alguna de sus filas ya fueron importados.
 *
 * No escribe nada: si el usuario todavía no tiene portfolio o cuenta para este
 * broker, no puede haber colisiones y devolvemos un resultado vacío en vez de
 * crear los targets por defecto (eso lo hace el commit).
 */
export async function checkImportDuplicatesAction(
  input: CheckImportDuplicatesInput
): Promise<DuplicateCheckResult | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const broker = await prisma.broker.findUnique({ where: { code: input.brokerCode } });
  if (!broker) return { error: "Broker no encontrado" };

  const rows = input.rows.filter((r) => r.status !== "invalid" && r.parsed);
  const empty: DuplicateCheckResult = {
    sameFileBatches: [],
    duplicateRows: [],
    freshCount: rows.length,
    totalCount: rows.length,
  };
  if (rows.length === 0) return empty;

  // El hash de idempotencia incluye el brokerAccountId, así que el chequeo debe
  // usar exactamente la misma cuenta que va a usar el commit.
  let brokerAccountId = input.brokerAccountId;
  if (!brokerAccountId) {
    const targets = await findDefaultImportTargets(user.id, broker.id);
    brokerAccountId = targets.account?.id;
  } else {
    const owned = await prisma.brokerAccount.findFirst({
      where: { id: brokerAccountId, userId: user.id },
      select: { id: true },
    });
    if (!owned) return { error: "Cuenta de broker no encontrada" };
  }

  const sameFileBatchRows = await prisma.importBatch.findMany({
    where: { userId: user.id, fileHash: input.fileHash, status: ImportStatus.COMMITTED },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileName: true,
      createdAt: true,
      committedAt: true,
      rowsImported: true,
      broker: { select: { name: true } },
    },
  });

  const sameFileBatches: DuplicateBatch[] = sameFileBatchRows.map((b) => ({
    importBatchId: b.id,
    fileName: b.fileName,
    createdAt: b.createdAt.toISOString(),
    committedAt: b.committedAt?.toISOString() ?? null,
    rowsImported: b.rowsImported,
    brokerName: b.broker.name,
  }));

  // Sin cuenta todavía no hay transacciones de este broker: ninguna fila puede colisionar.
  if (!brokerAccountId) {
    return { ...empty, sameFileBatches };
  }

  // Const local: TS no conserva el narrowing de un `let` capturado en el closure.
  const accountId = brokerAccountId;
  const hashed = rows.map((row) => ({
    rowNumber: row.rowNumber,
    parsed: row.parsed,
    idempotencyHash: buildImportIdempotencyHash({
      brokerAccountId: accountId,
      row: row.parsed,
      rowNumber: row.rowNumber,
    }),
  }));

  const existing = await prisma.transaction.findMany({
    where: { idempotencyHash: { in: hashed.map((h) => h.idempotencyHash) } },
    orderBy: { idempotencyVersion: "desc" },
    select: {
      id: true,
      idempotencyHash: true,
      idempotencyVersion: true,
      createdAt: true,
      importBatch: {
        select: { fileName: true, broker: { select: { name: true } } },
      },
    },
  });

  // Un hash puede tener varias versiones (re-imports forzados previos). Nos
  // quedamos con la más alta para poder calcular la próxima.
  const byHash = new Map<string, DuplicateRow["existing"]>();
  for (const e of existing) {
    const prev = byHash.get(e.idempotencyHash);
    if (prev && prev.maxVersion >= e.idempotencyVersion) continue;
    byHash.set(e.idempotencyHash, {
      transactionId: e.id,
      createdAt: e.createdAt.toISOString(),
      fileName: e.importBatch?.fileName ?? null,
      brokerName: e.importBatch?.broker.name ?? null,
      maxVersion: e.idempotencyVersion,
    });
  }

  const duplicateRows: DuplicateRow[] = [];
  for (const h of hashed) {
    const match = byHash.get(h.idempotencyHash);
    if (!match) continue;
    duplicateRows.push(
      toDuplicateRow({
        rowNumber: h.rowNumber,
        idempotencyHash: h.idempotencyHash,
        parsed: h.parsed,
        existing: match,
      })
    );
  }

  return {
    sameFileBatches,
    duplicateRows,
    freshCount: rows.length - duplicateRows.length,
    totalCount: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export type CommitImportActionInput = {
  brokerCode: string;
  fileName: string;
  fileHash: string;
  portfolioId?: string;
  brokerAccountId?: string;
  rows: CommitImportRow[];
  /** Qué hacer con las filas ya existentes. Por defecto `skip`. */
  duplicateStrategy?: DuplicateStrategy;
};

export type CommitImportActionResult =
  | {
      ok: true;
      importBatchId: string;
      imported: number;
      skipped: number;
      duplicatesImported: number;
    }
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
    duplicateStrategy: input.duplicateStrategy,
  });

  if (result.ok) {
    revalidateImportConsumers();
  }

  return result;
}

// ---------------------------------------------------------------------------
// Listado y borrado de transacciones importadas
// ---------------------------------------------------------------------------

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

export type DeleteImportedResult =
  | { ok: true; deleted: number }
  | { ok: false; error: string };

/**
 * Borra transacciones importadas por id.
 *
 * Alcance acotado a propósito: `source = IMPORT` y portfolio del usuario. Las
 * operaciones cargadas a mano no se tocan desde acá.
 *
 * Después del borrado recalcula `rowsImported` de los lotes afectados y marca
 * como `REVERTED` los que quedaron vacíos, para que el historial no siga
 * declarando filas que ya no existen.
 */
export async function deleteImportedTransactionsAction(
  ids: string[]
): Promise<DeleteImportedResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "No autenticado" };

  const uniqueIds = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
  if (uniqueIds.length === 0) {
    return { ok: false, error: "No seleccionaste ninguna operación" };
  }
  if (uniqueIds.length > MAX_BULK_IDS) {
    return { ok: false, error: `No se pueden borrar más de ${MAX_BULK_IDS} operaciones a la vez` };
  }

  // Resolvemos primero para (a) verificar pertenencia y (b) saber qué lotes
  // hay que recalcular después.
  const owned = await prisma.transaction.findMany({
    where: {
      id: { in: uniqueIds },
      source: TransactionSource.IMPORT,
      portfolio: { userId: user.id },
    },
    select: { id: true, importBatchId: true },
  });

  if (owned.length === 0) {
    return { ok: false, error: "No se encontraron operaciones para borrar" };
  }

  const ownedIds = owned.map((t) => t.id);
  const affectedBatchIds = [
    ...new Set(owned.map((t) => t.importBatchId).filter((v): v is string => Boolean(v))),
  ];

  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const res = await tx.transaction.deleteMany({ where: { id: { in: ownedIds } } });

      for (const batchId of affectedBatchIds) {
        const remaining = await tx.transaction.count({ where: { importBatchId: batchId } });
        await tx.importBatch.update({
          where: { id: batchId },
          data: {
            rowsImported: remaining,
            status: remaining === 0 ? ImportStatus.REVERTED : ImportStatus.COMMITTED,
          },
        });
      }

      return res.count;
    });

    revalidateImportConsumers();
    return { ok: true, deleted };
  } catch (error) {
    console.error("deleteImportedTransactionsAction", error);
    return { ok: false, error: "No se pudieron borrar las operaciones. Volvé a intentar." };
  }
}

/**
 * Todas las pantallas que leen `Transaction`. Un import o un borrado las
 * invalida a todas: si agregás una pantalla que use holdings, sumala acá.
 */
function revalidateImportConsumers() {
  revalidatePath("/imports");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/dividends");
  revalidatePath("/bonds");
}
