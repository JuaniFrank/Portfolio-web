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

// Prisma's interactive-transaction timeout. Kept generous purely as a safety
// margin — the committed transaction only runs 3 statements, so it completes
// in milliseconds regardless of row count.
const TRANSACTION_TIMEOUT_MS = 15_000;

function venueFor(type: InstrumentType): string | null {
  return type === InstrumentType.CEDEAR ||
    type === InstrumentType.STOCK_AR ||
    type === InstrumentType.BOND_AR ||
    type === InstrumentType.LETRA ||
    type === InstrumentType.ON
    ? "BYMA"
    : null;
}

/** Stable identity of an instrument for the import lookup. */
function instrumentKey(parts: {
  ticker: string;
  type: InstrumentType;
  currencyCode: string;
  venueCode: string | null;
}): string {
  return `${parts.ticker}|${parts.type}|${parts.currencyCode}|${parts.venueCode ?? ""}`;
}

/**
 * Resolve every instrument referenced by the batch in bulk: one findMany for
 * the existing ones, one createMany for the missing ones. Runs OUTSIDE the
 * commit transaction — instruments are shared reference data, so creating one
 * that ends up unused (if the commit later rolls back) is harmless and gets
 * reused on retry. Returns a key→id map.
 */
async function resolveInstrumentsBatch(
  db: DbClient,
  rows: ParsedImportRowData[]
): Promise<Map<string, string>> {
  const wanted = new Map<
    string,
    { ticker: string; type: InstrumentType; currencyCode: string; venueCode: string | null }
  >();

  for (const p of rows) {
    if (!p.ticker || !p.instrumentType) continue;
    const parts = {
      ticker: p.ticker,
      type: p.instrumentType,
      currencyCode: p.currencyCode,
      venueCode: venueFor(p.instrumentType),
    };
    wanted.set(instrumentKey(parts), parts);
  }

  const map = new Map<string, string>();
  if (wanted.size === 0) return map;

  const tickers = [...new Set([...wanted.values()].map((w) => w.ticker))];
  const existing = await db.instrument.findMany({ where: { ticker: { in: tickers } } });
  for (const inst of existing) {
    map.set(
      instrumentKey({
        ticker: inst.ticker,
        type: inst.type,
        currencyCode: inst.currencyCode,
        venueCode: inst.venueCode,
      }),
      inst.id
    );
  }

  const missing = [...wanted.entries()].filter(([key]) => !map.has(key)).map(([, v]) => v);
  if (missing.length > 0) {
    await db.instrument.createMany({
      data: missing.map((m) => ({
        ticker: m.ticker,
        name: m.ticker,
        type: m.type,
        venueCode: m.venueCode,
        currencyCode: m.currencyCode,
        taxJurisdiction: m.currencyCode === "ARS" ? "AR" : "US",
      })),
      skipDuplicates: true,
    });

    const created = await db.instrument.findMany({
      where: { ticker: { in: missing.map((m) => m.ticker) } },
    });
    for (const inst of created) {
      map.set(
        instrumentKey({
          ticker: inst.ticker,
          type: inst.type,
          currencyCode: inst.currencyCode,
          venueCode: inst.venueCode,
        }),
        inst.id
      );
    }
  }

  return map;
}

function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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

  // --- Reads / preparation, OUTSIDE the transaction ---

  // 1. Hash every row up front.
  const hashed = importable.map((row) => ({
    parsed: row.parsed!,
    idempotencyHash: buildImportIdempotencyHash({
      brokerAccountId: input.brokerAccountId,
      row: row.parsed!,
      rowNumber: row.rowNumber,
    }),
  }));

  // 2. Drop duplicates in a single query (against the DB) plus within the batch.
  const existingHashes = await prisma.transaction.findMany({
    where: { idempotencyHash: { in: hashed.map((h) => h.idempotencyHash) } },
    select: { idempotencyHash: true },
  });
  const seen = new Set(existingHashes.map((e) => e.idempotencyHash));
  const toInsert = hashed.filter(({ idempotencyHash }) => {
    if (seen.has(idempotencyHash)) return false;
    seen.add(idempotencyHash);
    return true;
  });
  const skipped = hashed.length - toInsert.length;

  // 3. Resolve all instruments in bulk.
  let instrumentMap: Map<string, string>;
  try {
    instrumentMap = await resolveInstrumentsBatch(
      prisma,
      toInsert.map((t) => t.parsed)
    );
  } catch (error) {
    console.error("commitImportBatch:resolveInstruments", error);
    return { ok: false, error: "No se pudieron resolver los instrumentos del archivo" };
  }

  const instrumentIdFor = (parsed: ParsedImportRowData): string | null => {
    if (!parsed.ticker || !parsed.instrumentType) return null;
    return (
      instrumentMap.get(
        instrumentKey({
          ticker: parsed.ticker,
          type: parsed.instrumentType,
          currencyCode: parsed.currencyCode,
          venueCode: venueFor(parsed.instrumentType),
        })
      ) ?? null
    );
  };

  // --- Writes, INSIDE a short all-or-nothing transaction ---
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const batch = await tx.importBatch.create({
          data: {
            userId: input.userId,
            brokerId: input.brokerId,
            fileName: input.fileName,
            fileHash: input.fileHash,
            status: ImportStatus.COMMITTED,
            rowsTotal: importable.length,
            rowsImported: toInsert.length,
            rowsSkipped: skipped,
            committedAt: new Date(),
            rawSummary: { valid: importable.length, imported: toInsert.length, skipped },
          },
        });

        if (toInsert.length > 0) {
          await tx.transaction.createMany({
            data: toInsert.map(({ parsed, idempotencyHash }) => ({
              portfolioId: input.portfolioId,
              brokerAccountId: input.brokerAccountId,
              instrumentId: instrumentIdFor(parsed),
              type: parsed.type,
              tradeDate: new Date(parsed.tradeDate),
              settlementDate: toDateOrNull(parsed.settlementDate),
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
            })),
            skipDuplicates: true,
          });
        }

        return { importBatchId: batch.id, imported: toInsert.length, skipped };
      },
      { timeout: TRANSACTION_TIMEOUT_MS }
    );

    return { ok: true, ...result };
  } catch (error) {
    console.error("commitImportBatch", error);
    // The transaction rolled back — nothing was persisted, so a retry is safe.
    return {
      ok: false,
      error: "No se guardó ningún movimiento. Revisá el archivo y volvé a intentar.",
    };
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
