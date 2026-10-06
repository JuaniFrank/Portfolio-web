"use server";

import { createHash, randomUUID } from "crypto";
import { getCurrentUser } from "@/lib/auth";
import {
  toBondTrade,
  toHoldingRow,
  valuateOnPositions,
} from "@/lib/bonds/portfolio-bridge";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import { fetchOnPrices } from "@/lib/market/data912";
import { fetchInstrumentUniverse } from "@/lib/market/data912-universe";
import { refreshLatestQuotes, type InstrumentForQuote } from "@/lib/market/quotes";
import { prisma } from "@/lib/prisma";
import {
  InstrumentType,
  Prisma,
  TransactionSource,
  type TransactionType,
  type Settlement,
} from "@/lib/generated/prisma";
import {
  buildHoldings,
  computePortfolioSummary,
} from "@/lib/transactions/holdings";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import type { TradeHistoryRow, TransactionsPageData } from "@/lib/transactions/types";
import {
  FIXED_INCOME_TYPES,
  TRADE_INSTRUMENT_TYPES,
  TRADE_TYPES,
} from "@/lib/transactions/types";
import { computeTradeAmounts } from "@/lib/transactions/trade-amounts";
import { countByType } from "@/lib/transactions/delete-helpers";
import {
  deleteOwnedTransactions,
  revalidateTransactionConsumers,
} from "@/lib/transactions/mutations";
import {
  newTransactionInputSchema,
  type NewTransactionInput,
} from "@/lib/transactions/validations";

function toUsdPrice(priceArs: number, cclRate: number | null): string | null {
  if (!cclRate || cclRate <= 0) return null;
  return (priceArs / cclRate).toFixed(2);
}

function toArsFromUsd(amountUsd: number, cclRate: number | null): string {
  if (!cclRate || cclRate <= 0) return amountUsd.toFixed(2);
  return (amountUsd * cclRate).toFixed(2);
}

function tradePricesAndAmounts(
  price: number,
  netAmount: number,
  currencyCode: string,
  cclRate: number | null
): Pick<TradeHistoryRow, "priceArs" | "priceUsd" | "amountArs" | "amountUsd"> {
  const amountAbs = Math.abs(netAmount);

  if (currencyCode === "USD") {
    return {
      priceUsd: price.toFixed(2),
      priceArs: toArsFromUsd(price, cclRate),
      amountUsd: amountAbs.toFixed(2),
      amountArs: toArsFromUsd(amountAbs, cclRate),
    };
  }

  return {
    priceArs: price.toFixed(2),
    priceUsd: toUsdPrice(price, cclRate),
    amountArs: amountAbs.toFixed(2),
    amountUsd: toUsdPrice(amountAbs, cclRate),
  };
}

export async function getTransactionsPageDataAction(): Promise<
  TransactionsPageData | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const [rows, latestFx, eventRows] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        portfolio: { userId: user.id },
        type: { in: TRADE_TYPES },
        instrument: { type: { in: TRADE_INSTRUMENT_TYPES } },
        instrumentId: { not: null },
      },
      orderBy: { tradeDate: "desc" },
      include: {
        instrument: {
          select: {
            id: true,
            ticker: true,
            name: true,
            type: true,
            currencyCode: true,
            settlement: true,
            baseInstrument: { select: { ticker: true } },
          },
        },
        importBatch: {
          select: { broker: { select: { code: true, name: true } } },
        },
        tags: { include: { tag: { select: { name: true } } } },
      },
    }),
    prisma.fxRate.findFirst({
      where: {
        baseCurrencyCode: "USD",
        quoteCurrencyCode: "ARS",
      },
      orderBy: { date: "desc" },
    }),
    prisma.corporateEvent.findMany({
      where: {
        instrument: {
          transactions: { some: { portfolio: { userId: user.id } } },
        },
      },
      orderBy: { effectiveDate: "asc" },
      select: {
        instrumentId: true,
        eventType: true,
        effectiveDate: true,
        numerator: true,
        denominator: true,
      },
    }),
  ]);

  // Build events map: instrumentId → events sorted ascending by effectiveDate
  const eventsMap = new Map<string, CorporateEventForBuilder[]>();
  for (const e of eventRows) {
    const list = eventsMap.get(e.instrumentId) ?? [];
    list.push({
      instrumentId: e.instrumentId,
      eventType: e.eventType,
      effectiveDate: e.effectiveDate.toISOString().slice(0, 10),
      numerator: e.numerator.toString(),
      denominator: e.denominator.toString(),
    });
    eventsMap.set(e.instrumentId, list);
  }

  const cclRate = latestFx ? Number(latestFx.mid) : null;

  const tradesForHoldings: TradeForHoldings[] = [];
  const onBondTrades: ReturnType<typeof toBondTrade>[] = [];
  const onNamesById = new Map<string, string>();
  const history: TradeHistoryRow[] = [];
  const uniqueInstruments = new Map<string, InstrumentForQuote>();

  for (const r of rows) {
    if (!r.instrument) continue;

    const price = Number(r.price);
    const qty = Number(r.quantity);
    const trade: TradeForHoldings = {
      instrumentId: r.instrument.id,
      ticker: r.instrument.ticker,
      instrumentType: r.instrument.type,
      instrumentName: r.instrument.name,
      type: r.type as "BUY" | "SELL",
      quantity: r.quantity.toString(),
      price: r.price.toString(),
      netAmount: r.netAmount.toString(),
      tradeDate: r.tradeDate.toISOString(),
    };

    if (FIXED_INCOME_TYPES.includes(r.instrument.type)) {
      onBondTrades.push(toBondTrade(trade, r.currencyCode));
      onNamesById.set(r.instrument.id, r.instrument.name);
    } else {
      tradesForHoldings.push(trade);
      if (!uniqueInstruments.has(r.instrument.id)) {
        uniqueInstruments.set(r.instrument.id, {
          id: r.instrument.id,
          ticker: r.instrument.ticker,
          type: r.instrument.type,
          currencyCode: r.instrument.currencyCode,
          settlement: r.instrument.settlement,
          baseInstrument: r.instrument.baseInstrument,
        });
      }
    }

    const tagFromDb = r.tags[0]?.tag.name;
    const tagFromBroker = r.importBatch?.broker.code.toLowerCase();
    const tagLabel = tagFromDb ?? tagFromBroker ?? null;
    const { priceArs, priceUsd, amountArs, amountUsd } = tradePricesAndAmounts(
      price,
      Number(r.netAmount),
      r.currencyCode,
      cclRate
    );

    history.push({
      id: r.id,
      tradeDate: r.tradeDate.toISOString(),
      type: r.type,
      ticker: r.instrument.ticker,
      instrumentType: r.instrument.type,
      instrumentName: r.instrument.name,
      quantity: qty.toString(),
      priceArs,
      priceUsd,
      amountArs,
      amountUsd,
      currencyCode: r.currencyCode,
      tagLabel,
      source: r.source,
    });
  }

  const onTickers = Array.from(new Set(onBondTrades.map((t) => t.ticker.toUpperCase())));

  const [{ prices: latestPrices }, onPriceResult] = await Promise.all([
    refreshLatestQuotes([...uniqueInstruments.values()]),
    onTickers.length > 0 ? fetchOnPrices(onTickers) : Promise.resolve({ quotes: new Map(), stale: false }),
  ]);

  const equityHoldings = buildHoldings(tradesForHoldings, latestPrices, eventsMap);
  const onPositions = valuateOnPositions(onBondTrades, onPriceResult, cclRate, onNamesById);
  const onHoldings = onPositions.map((p) => toHoldingRow(p));
  const holdings = [...equityHoldings, ...onHoldings].sort((a, b) =>
    a.ticker.localeCompare(b.ticker)
  );
  const summaryBase = computePortfolioSummary(holdings);

  return {
    holdings,
    trades: history,
    summary: {
      ...summaryBase,
      cclRate: cclRate?.toFixed(2) ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Manual transaction creation
// ---------------------------------------------------------------------------

export type TransactionInstrumentOption = {
  ticker: string;
  name: string;
  type: InstrumentType;
  currencyCode: string;
  /** FR-8: no chip renders for "ARS". */
  settlement: Settlement;
};

const SEARCH_LIMIT = 10;
const TICKER_PATTERN = /^[A-Z0-9.]{2,12}$/;

/**
 * Autocomplete search over the instrument catalog (the BYMA universe synced
 * from data912 into our Instrument table). Matches ticker or name.
 *
 * Lazy self-heal (option C): if the DB has nothing for what looks like an
 * exact ticker, we check the live data912 universe once, insert the match, and
 * return it — covering the gap between nightly catalog syncs.
 */
export async function searchInstrumentsAction(
  query: string
): Promise<TransactionInstrumentOption[]> {
  const user = await getCurrentUser();
  if (!user) return [];

  const q = query.trim();
  if (q.length < 1) return [];

  const rows = await prisma.instrument.findMany({
    where: {
      active: true,
      type: { in: TRADE_INSTRUMENT_TYPES },
      OR: [
        { ticker: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
      ],
    },
    select: {
      ticker: true,
      name: true,
      type: true,
      currencyCode: true,
      settlement: true,
      baseInstrument: { select: { ticker: true } },
    },
    take: SEARCH_LIMIT * 4, // over-fetch: sorted/trimmed below by ticker family
  });

  if (rows.length > 0) {
    // FR-8: flat, independent rows — no grouping/nesting of variants under a
    // base — but within a ticker family (own ticker for a base, or the
    // linked base's ticker for a variant) the ARS row sorts first, ahead of
    // strict alphabetical order. Plain ticker-ASC is not sufficient: a
    // ticker-rewrite family (TGNO4/TGN4D) is not a prefix relationship, so
    // alphabetical order alone would NOT put the base first.
    const sorted = [...rows]
      .sort((a, b) => {
        const familyA = a.baseInstrument?.ticker ?? a.ticker;
        const familyB = b.baseInstrument?.ticker ?? b.ticker;
        if (familyA !== familyB) return familyA.localeCompare(familyB);
        const rankA = a.settlement === "ARS" ? 0 : 1;
        const rankB = b.settlement === "ARS" ? 0 : 1;
        if (rankA !== rankB) return rankA - rankB;
        return a.ticker.localeCompare(b.ticker);
      })
      .slice(0, SEARCH_LIMIT)
      .map(({ ticker, name, type, currencyCode, settlement }) => ({
        ticker,
        name,
        type,
        currencyCode,
        settlement,
      }));
    return sorted;
  }

  // --- Self-heal: nothing in the catalog, but it looks like a real ticker ---
  const upper = q.toUpperCase();
  if (!TICKER_PATTERN.test(upper)) return [];

  const universe = await fetchInstrumentUniverse();
  const matches = universe
    .filter((i) => i.ticker === upper || i.ticker.startsWith(upper))
    .slice(0, SEARCH_LIMIT);
  if (matches.length === 0) return [];

  const healed: TransactionInstrumentOption[] = [];
  for (const m of matches) {
    const identity = {
      ticker: m.ticker,
      type: m.type,
      // venueCode: m.venueCode,
      // currencyCode: m.currencyCode,
    } as const;
    const inst = await prisma.instrument.findFirst({ where: identity });
    // Si no se encuentra, no se puede crear porque el ticker no es válido.
    if (!inst) continue;
    healed.push({
      ticker: inst.ticker,
      name: inst.name,
      type: inst.type,
      currencyCode: inst.currencyCode,
      settlement: inst.settlement,
    });
  }
  return healed;
}

/** Same venue convention the importer uses, so manual and imported trades
 * resolve to the SAME instrument row instead of creating a duplicate. */
function venueForType(type: InstrumentType): string | null {
  return type === InstrumentType.CEDEAR ||
    type === InstrumentType.STOCK_AR ||
    type === InstrumentType.BOND_AR ||
    type === InstrumentType.LETRA ||
    type === InstrumentType.ON
    ? "BYMA"
    : null;
}

/** Resolve the portfolio + broker account a manual trade should land in,
 * creating the defaults on first use so manual-only users can operate. */
async function ensureManualTargets(userId: string) {
  let portfolio = await prisma.portfolio.findFirst({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!portfolio) {
    portfolio = await prisma.portfolio.create({
      data: { userId, name: "Principal", isDefault: true, baseCurrencyCode: "ARS" },
    });
  }

  // Reuse any existing account first; fall back to a dedicated "Manual" broker.
  let account = await prisma.brokerAccount.findFirst({
    where: { userId, archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!account) {
    const broker = await prisma.broker.upsert({
      where: { code: "MANUAL" },
      update: {},
      create: { code: "MANUAL", name: "Manual", enabled: true },
    });
    account = await prisma.brokerAccount.create({
      data: { userId, brokerId: broker.id, name: "Carga manual", currencyCode: "ARS" },
    });
  }

  return { portfolio, account };
}

/** Resolve-or-create the instrument by its stable identity, matching imports.
 * findFirst + create (not upsert): venueCode is nullable and part of the
 * compound unique, which Prisma can't target with null in an upsert where. */
async function resolveOrCreateInstrument(data: NewTransactionInput) {
  const identity = {
    ticker: data.ticker,
    type: data.instrumentType,
    venueCode: venueForType(data.instrumentType),
    currencyCode: data.currencyCode,
  } as const;

  let instrument = await prisma.instrument.findFirst({ where: identity });
  if (!instrument) {
    try {
      instrument = await prisma.instrument.create({
        data: {
          ...identity,
          name: data.ticker,
          taxJurisdiction: data.currencyCode === "ARS" ? "AR" : "US",
        },
      });
    } catch (err) {
      // Lost a race against a concurrent insert — re-read the winner.
      if (
        err != null &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        instrument = await prisma.instrument.findFirst({ where: identity });
      }
      if (!instrument) throw err;
    }
  }
  return instrument;
}

export async function createTransactionAction(
  input: NewTransactionInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const parsed = newTransactionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }
  const data = parsed.data;

  const { portfolio, account } = await ensureManualTargets(user.id);
  const instrument = await resolveOrCreateInstrument(data);
  const amounts = computeTradeAmounts(data);

  const idempotencyHash = createHash("sha256")
    .update(`manual|${user.id}|${randomUUID()}`)
    .digest("hex");

  await prisma.transaction.create({
    data: {
      portfolioId: portfolio.id,
      brokerAccountId: account.id,
      instrumentId: instrument.id,
      type: data.side,
      tradeDate: new Date(data.tradeDate),
      quantity: new Prisma.Decimal(data.quantity),
      price: new Prisma.Decimal(data.price),
      currencyCode: data.currencyCode,
      grossAmount: new Prisma.Decimal(amounts.grossAmount),
      fees: new Prisma.Decimal(amounts.fees),
      taxes: new Prisma.Decimal(amounts.taxes),
      netAmount: new Prisma.Decimal(amounts.netAmount),
      source: TransactionSource.MANUAL,
      idempotencyHash,
    },
  });

  revalidateTransactionConsumers();

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Edit / delete
// ---------------------------------------------------------------------------

type ActionError = { ok: false; error: string };

/**
 * Loads a BUY/SELL transaction owned by the user as the form's input shape, to
 * prefill the edit dialog. Other transaction types have no form and aren't
 * editable here.
 */
export async function getTransactionForEditAction(
  id: string
): Promise<{ ok: true; input: NewTransactionInput } | ActionError> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const row = await prisma.transaction.findFirst({
    where: { id, portfolio: { userId: user.id }, type: { in: TRADE_TYPES } },
    include: { instrument: { select: { ticker: true, type: true } } },
  });
  if (!row || !row.instrument) return { ok: false, error: "No se encontró la operación" };

  const currencyCode = row.currencyCode === "USD" ? "USD" : "ARS";
  return {
    ok: true,
    input: {
      ticker: row.instrument.ticker,
      instrumentType: row.instrument.type,
      side: row.type as "BUY" | "SELL",
      currencyCode,
      tradeDate: row.tradeDate.toISOString().slice(0, 10),
      quantity: row.quantity.toString(),
      price: row.price.toString(),
      fees: row.fees.toString(),
      taxes: row.taxes.toString(),
    },
  };
}

/**
 * Edits a BUY/SELL transaction in place. Validation and amounts are the same
 * as create. Provenance (`source`, `importBatchId`, `idempotencyHash`,
 * `idempotencyVersion`) is never touched, so an edited imported row stays tied
 * to its batch and a re-import of the original row is still flagged as a
 * duplicate. Imported `marketRights` is preserved and counted in the net.
 */
export async function updateTransactionAction(
  id: string,
  input: NewTransactionInput
): Promise<{ ok: true } | ActionError> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const parsed = newTransactionInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }
  const data = parsed.data;

  const existing = await prisma.transaction.findFirst({
    where: { id, portfolio: { userId: user.id }, type: { in: TRADE_TYPES } },
    include: { instrument: { select: { ticker: true, type: true, currencyCode: true } } },
  });
  if (!existing) return { ok: false, error: "No se encontró la operación" };

  // Keep the linked instrument when ticker, type and currency are unchanged:
  // re-resolving by identity could land on a different venue variant. Currency
  // is part of the instrument identity, so changing it must re-resolve.
  const sameInstrument =
    existing.instrumentId != null &&
    existing.instrument?.ticker === data.ticker &&
    existing.instrument?.type === data.instrumentType &&
    existing.instrument?.currencyCode === data.currencyCode;
  const instrumentId = sameInstrument
    ? existing.instrumentId!
    : (await resolveOrCreateInstrument(data)).id;

  const amounts = computeTradeAmounts({
    ...data,
    marketRights: existing.marketRights.toString(),
  });

  try {
    // updateMany scoped by ownership: the check above is not the only guard.
    const res = await prisma.transaction.updateMany({
      where: { id, portfolio: { userId: user.id } },
      data: {
        instrumentId,
        type: data.side,
        tradeDate: new Date(data.tradeDate),
        quantity: new Prisma.Decimal(data.quantity),
        price: new Prisma.Decimal(data.price),
        currencyCode: data.currencyCode,
        grossAmount: new Prisma.Decimal(amounts.grossAmount),
        fees: new Prisma.Decimal(amounts.fees),
        taxes: new Prisma.Decimal(amounts.taxes),
        netAmount: new Prisma.Decimal(amounts.netAmount),
      },
    });
    if (res.count === 0) return { ok: false, error: "No se encontró la operación" };
  } catch (error) {
    console.error("updateTransactionAction", error);
    return { ok: false, error: "No se pudo guardar la operación. Volvé a intentar." };
  }

  revalidateTransactionConsumers();
  return { ok: true };
}

/** Deletes one transaction (any source) plus its tags, and fixes its import batch. */
export async function deleteTransactionAction(
  id: string
): Promise<{ ok: true } | ActionError> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  try {
    const deleted = await deleteOwnedTransactions(user.id, { id });
    if (deleted === 0) return { ok: false, error: "No se encontró la operación" };
  } catch (error) {
    console.error("deleteTransactionAction", error);
    return { ok: false, error: "No se pudo borrar la operación. Volvé a intentar." };
  }

  revalidateTransactionConsumers();
  return { ok: true };
}

export type HoldingDeletionPreview = {
  ticker: string;
  total: number;
  /** Transactions that would be deleted, per `TransactionType`. */
  countsByType: Partial<Record<TransactionType, number>>;
};

/**
 * A holding is keyed by `instrumentId` (the page aggregates all of the user's
 * portfolios and accounts per instrument), so deleting it means every
 * transaction of the user linked to that instrument: trades plus dividends,
 * coupons, amortizations and withholdings.
 */
export async function getHoldingDeletionPreviewAction(
  instrumentId: string
): Promise<{ ok: true; preview: HoldingDeletionPreview } | ActionError> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  const [rows, instrument] = await Promise.all([
    prisma.transaction.findMany({
      where: { instrumentId, portfolio: { userId: user.id } },
      select: { type: true },
    }),
    prisma.instrument.findUnique({ where: { id: instrumentId }, select: { ticker: true } }),
  ]);
  if (rows.length === 0 || !instrument) {
    return { ok: false, error: "No se encontraron operaciones de esta posición" };
  }

  return {
    ok: true,
    preview: { ticker: instrument.ticker, total: rows.length, countsByType: countByType(rows) },
  };
}

/**
 * Deletes a holding: all of the user's transactions for the instrument. The
 * Instrument itself, its prices and events are shared and stay untouched.
 */
export async function deleteHoldingAction(
  instrumentId: string
): Promise<{ ok: true; deleted: number } | ActionError> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "unauthorized" };

  try {
    const deleted = await deleteOwnedTransactions(user.id, { instrumentId });
    if (deleted === 0) {
      return { ok: false, error: "No se encontraron operaciones de esta posición" };
    }
    revalidateTransactionConsumers();
    return { ok: true, deleted };
  } catch (error) {
    console.error("deleteHoldingAction", error);
    return { ok: false, error: "No se pudo borrar la posición. Volvé a intentar." };
  }
}
