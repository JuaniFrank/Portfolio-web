import {
  ImportStatus,
  InstrumentType,
  Prisma,
  TransactionSource,
  type PrismaClient,
} from "@/lib/generated/prisma";
import { prisma } from "@/lib/prisma";
import { buildImportIdempotencyHash } from "./idempotency";
import type { CommitImportRow, ParsedImportRowData } from "./types";

export type CommitImportInput = {
  userId: string;
  brokerId: string;
  brokerAccountId: string;
  portfolioId: string;
  fileName: string;
  fileHash: string;
  rows: CommitImportRow[];
};

export type CommitImportResult =
  | { ok: true; importBatchId: string; imported: number; skipped: number }
  | { ok: false; error: string };

type DbClient = PrismaClient | Prisma.TransactionClient;

async function resolveInstrument(
  db: DbClient,
  parsed: ParsedImportRowData
): Promise<string | null> {
  if (!parsed.ticker || !parsed.instrumentType) {
    return null;
  }

  const venueCode =
    parsed.instrumentType === InstrumentType.CEDEAR ||
    parsed.instrumentType === InstrumentType.STOCK_AR ||
    parsed.instrumentType === InstrumentType.BOND_AR ||
    parsed.instrumentType === InstrumentType.LETRA ||
    parsed.instrumentType === InstrumentType.ON
      ? "BYMA"
      : null;

  const existing = await db.instrument.findFirst({
    where: {
      ticker: parsed.ticker,
      type: parsed.instrumentType,
      currencyCode: parsed.currencyCode,
      venueCode,
    },
  });

  if (existing) return existing.id;

  const created = await db.instrument.create({
    data: {
      ticker: parsed.ticker,
      name: parsed.ticker,
      type: parsed.instrumentType,
      venueCode,
      currencyCode: parsed.currencyCode,
      taxJurisdiction: parsed.currencyCode === "ARS" ? "AR" : "US",
    },
  });

  return created.id;
}

export async function commitImportBatch(input: CommitImportInput): Promise<CommitImportResult> {
  const account = await prisma.brokerAccount.findFirst({
    where: { id: input.brokerAccountId, userId: input.userId },
  });
  if (!account) {
    return { ok: false, error: "Cuenta de broker no encontrada" };
  }

  const portfolio = await prisma.portfolio.findFirst({
    where: { id: input.portfolioId, userId: input.userId },
  });
  if (!portfolio) {
    return { ok: false, error: "Portfolio no encontrado" };
  }

  const importable = input.rows.filter((r) => r.status !== "invalid" && r.parsed);
  if (importable.length === 0) {
    return { ok: false, error: "No hay filas válidas para importar" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.importBatch.create({
        data: {
          userId: input.userId,
          brokerId: input.brokerId,
          fileName: input.fileName,
          fileHash: input.fileHash,
          status: ImportStatus.PREVIEW,
          rowsTotal: importable.length,
        },
      });

      let imported = 0;
      let skipped = 0;

      for (const row of importable) {
        const parsed = row.parsed;
        const idempotencyHash = buildImportIdempotencyHash({
          brokerAccountId: input.brokerAccountId,
          row: parsed,
          rowNumber: row.rowNumber,
        });

        const duplicate = await tx.transaction.findFirst({
          where: { idempotencyHash },
        });
        if (duplicate) {
          skipped += 1;
          continue;
        }

        const instrumentId = await resolveInstrument(tx, parsed);

        await tx.transaction.create({
          data: {
            portfolioId: input.portfolioId,
            brokerAccountId: input.brokerAccountId,
            instrumentId,
            type: parsed.type,
            tradeDate: new Date(parsed.tradeDate),
            settlementDate: new Date(parsed.settlementDate),
            quantity: new Prisma.Decimal(parsed.quantity),
            price: new Prisma.Decimal(parsed.price ?? "0"),
            currencyCode: parsed.currencyCode,
            grossAmount: new Prisma.Decimal(parsed.grossAmount),
            netAmount: new Prisma.Decimal(parsed.netAmount),
            brokerFxRate: parsed.brokerFxRate ? new Prisma.Decimal(parsed.brokerFxRate) : null,
            source: TransactionSource.IMPORT,
            importBatchId: batch.id,
            externalId: parsed.externalId,
            idempotencyHash,
            notes: parsed.description,
          },
        });
        imported += 1;
      }

      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status: ImportStatus.COMMITTED,
          rowsImported: imported,
          rowsSkipped: skipped,
          committedAt: new Date(),
          rawSummary: { valid: importable.length, imported, skipped },
        },
      });

      return { importBatchId: batch.id, imported, skipped };
    });

    return { ok: true, ...result };
  } catch (error) {
    console.error("commitImportBatch", error);
    return { ok: false, error: "Error al guardar las transacciones" };
  }
}

export async function ensureDefaultImportTargets(userId: string, brokerId: string) {
  let portfolio = await prisma.portfolio.findFirst({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });

  if (!portfolio) {
    portfolio = await prisma.portfolio.create({
      data: {
        userId,
        name: "Principal",
        isDefault: true,
        baseCurrencyCode: "ARS",
      },
    });
  }

  let account = await prisma.brokerAccount.findFirst({
    where: { userId, brokerId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });

  if (!account) {
    account = await prisma.brokerAccount.create({
      data: {
        userId,
        brokerId,
        name: "Cuenta principal",
        currencyCode: "ARS",
      },
    });
  }

  return { portfolio, account };
}
