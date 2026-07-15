"use server";

import { createHash, randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import {
  toBondTrade,
  toHoldingRow,
  valuateOnPositions,
} from "@/lib/bonds/portfolio-bridge";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import { fetchOnPrices } from "@/lib/market/data912";
import { fetchInstrumentUniverse } from "@/lib/market/data912-universe";
import { displayNameFor } from "@/lib/market/instrument-names";
import { refreshLatestQuotes, type InstrumentForQuote } from "@/lib/market/quotes";
import { prisma } from "@/lib/prisma";
import {
  InstrumentType,
  Prisma,
  TransactionSource,
} from "@/lib/generated/prisma";
import {
  buildHoldings,
  computePortfolioSummary,
} from "@/lib/transactions/holdings";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import type { TradeHistoryRow, TransactionsPageData } from "@/lib/transactions/types";
import { TRADE_INSTRUMENT_TYPES, TRADE_TYPES } from "@/lib/transactions/types";
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
          select: { id: true, ticker: true, name: true, type: true },
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

    if (r.instrument.type === "ON") {
      onBondTrades.push(toBondTrade(trade, r.currencyCode));
      onNamesById.set(r.instrument.id, r.instrument.name);
    } else {
      tradesForHoldings.push(trade);
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

  const uniqueInstruments = new Map<string, InstrumentForQuote>();
  for (const t of tradesForHoldings) {
    if (!uniqueInstruments.has(t.instrumentId)) {
      uniqueInstruments.set(t.instrumentId, {
        id: t.instrumentId,
        ticker: t.ticker,
        type: t.instrumentType,
      });
    }
  }

  const onTickers = Array.from(new Set(onBondTrades.map((t) => t.ticker.toUpperCase())));

  const [{ prices: latestPrices }, onPriceResult] = await Promise.all([
    refreshLatestQuotes([...uniqueInstruments.values()]),
    onTickers.length > 0 ? fetchOnPrices(onTickers) : Promise.resolve({ quotes: new Map(), stale: false }),
  ]);

  const equityHoldings = buildHoldings(tradesForHoldings, latestPrices, eventsMap);
  const onPositions = valuateOnPositions(onBondTrades, onPriceResult, cclRate, onNamesById);
  const onHoldings = onPositions.map((p) => toHoldingRow(p, cclRate));
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
    select: { ticker: true, name: true, type: true, currencyCode: true },
    // Prefix matches on the ticker feel most relevant, so surface them first.
    orderBy: [{ ticker: "asc" }],
    take: SEARCH_LIMIT,
  });

  if (rows.length > 0) return rows;

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
      venueCode: m.venueCode,
      currencyCode: m.currencyCode,
    } as const;
    let inst = await prisma.instrument.findFirst({ where: identity });
    if (!inst) {
      try {
        inst = await prisma.instrument.create({
          data: {
            ...identity,
            name: displayNameFor(m.ticker),
            taxJurisdiction: m.currencyCode === "ARS" ? "AR" : "US",
            active: true,
          },
        });
      } catch {
        continue; // lost a race or transient error — skip this one
      }
    }
    healed.push({
      ticker: inst.ticker,
      name: inst.name,
      type: inst.type,
      currencyCode: inst.currencyCode,
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
  const venueCode = venueForType(data.instrumentType);
  const identity = {
    ticker: data.ticker,
    type: data.instrumentType,
    venueCode,
    currencyCode: data.currencyCode,
  } as const;

  // Resolve-or-create the instrument by its stable identity, matching imports.
  // findFirst + create (not upsert): venueCode is nullable and part of the
  // compound unique, which Prisma can't target with null in an upsert where.
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

  const quantity = new Prisma.Decimal(data.quantity);
  const price = new Prisma.Decimal(data.price);
  const fees = new Prisma.Decimal(data.fees ?? "0");
  const taxes = new Prisma.Decimal(data.taxes ?? "0");
  const grossAmount = quantity.mul(price);
  // Cash out of pocket on a buy adds costs; proceeds on a sell net them out.
  const netAmount =
    data.side === "BUY"
      ? grossAmount.plus(fees).plus(taxes)
      : grossAmount.minus(fees).minus(taxes);

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
      quantity,
      price,
      currencyCode: data.currencyCode,
      grossAmount,
      fees,
      taxes,
      netAmount,
      source: TransactionSource.MANUAL,
      idempotencyHash,
    },
  });

  revalidatePath("/transactions");
  revalidatePath("/dashboard");

  return { ok: true };
}
