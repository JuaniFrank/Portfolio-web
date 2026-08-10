import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma";
import {
  toDashboardHolding,
  toBondTrade,
  valuateOnPositions,
} from "@/lib/bonds/portfolio-bridge";
import type { HoldingForDashboard } from "@/lib/dashboard/build";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import { fetchOnPrices } from "@/lib/market/data912";
import { resolveCclRate } from "@/lib/market/ccl-rate";
import { refreshLatestQuotes, type InstrumentForQuote } from "@/lib/market/quotes";
import {
  buildHoldings,
  type TradeForHoldings,
} from "@/lib/transactions/holdings";
import { TRADE_INSTRUMENT_TYPES, TRADE_TYPES } from "@/lib/transactions/types";

export type PortfolioValuationResult = {
  totalValueArs: number;
  totalValueUsd: number;
  cashArs: number;
  cashUsd: number;
  netDepositsArs: number;
  netDepositsUsd: number;
  twrSinceInception: number | null;
  positions: Prisma.InputJsonValue;
};

export async function calculatePortfolioValuation(
  portfolioId: string
): Promise<PortfolioValuationResult> {
  const [rows, cclRate, eventRows] = await Promise.all([
    prisma.transaction.findMany({
      where: { portfolioId },
      orderBy: { tradeDate: "asc" },
      include: {
        instrument: {
          select: {
            id: true,
            ticker: true,
            name: true,
            type: true,
            underlyingAsset: { select: { sector: true } },
          },
        },
      },
    }),
    resolveCclRate(),
    prisma.corporateEvent.findMany({
      where: {
        instrument: {
          transactions: { some: { portfolioId } },
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

  const trades: TradeForHoldings[] = [];
  const onBondTrades: ReturnType<typeof toBondTrade>[] = [];
  const sectorByInstrument = new Map<string, string | null>();
  const onNamesById = new Map<string, string>();

  let cashArs = new Decimal(0);
  let cashUsd = new Decimal(0);
  let netDepositsArs = new Decimal(0);
  let netDepositsUsd = new Decimal(0);

  for (const r of rows) {
    const isUsd = ["USD", "USD_MEP", "USD_CABLE", "USDT", "USDC"].includes(
      r.currencyCode.toUpperCase()
    );
    const amount = new Decimal(r.netAmount.toString()).abs();

    switch (r.type) {
      case "DEPOSIT":
      case "TRANSFER_IN":
        if (isUsd) {
          cashUsd = cashUsd.plus(amount);
          netDepositsUsd = netDepositsUsd.plus(amount);
        } else {
          cashArs = cashArs.plus(amount);
          netDepositsArs = netDepositsArs.plus(amount);
        }
        break;
      case "WITHDRAWAL":
      case "TRANSFER_OUT":
        if (isUsd) {
          cashUsd = cashUsd.minus(amount);
          netDepositsUsd = netDepositsUsd.minus(amount);
        } else {
          cashArs = cashArs.minus(amount);
          netDepositsArs = netDepositsArs.minus(amount);
        }
        break;
      case "BUY":
      case "FEE":
      case "TAX_WITHHOLDING":
        if (isUsd) {
          cashUsd = cashUsd.minus(amount);
        } else {
          cashArs = cashArs.minus(amount);
        }
        break;
      case "SELL":
      case "DIVIDEND_CASH":
      case "COUPON":
      case "AMORTIZATION":
      case "INTEREST":
        if (isUsd) {
          cashUsd = cashUsd.plus(amount);
        } else {
          cashArs = cashArs.plus(amount);
        }
        break;
    }

    if (!r.instrument) continue;
    if (!TRADE_TYPES.includes(r.type as any)) continue;
    if (!TRADE_INSTRUMENT_TYPES.includes(r.instrument.type as any)) continue;

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
      continue;
    }

    trades.push(trade);
    sectorByInstrument.set(
      r.instrument.id,
      r.instrument.underlyingAsset?.sector ?? null
    );
  }

  const uniqueInstruments = new Map<string, InstrumentForQuote>();
  for (const t of trades) {
    if (!uniqueInstruments.has(t.instrumentId)) {
      uniqueInstruments.set(t.instrumentId, {
        id: t.instrumentId,
        ticker: t.ticker,
        type: t.instrumentType,
      });
    }
  }

  const onTickers = Array.from(
    new Set(onBondTrades.map((t) => t.ticker.toUpperCase()))
  );

  const [{ prices }, onPriceResult] = await Promise.all([
    refreshLatestQuotes([...uniqueInstruments.values()]),
    onTickers.length > 0
      ? fetchOnPrices(onTickers)
      : Promise.resolve({ quotes: new Map(), stale: false }),
  ]);

  const equityHoldings = buildHoldings(trades, prices, eventsMap);
  const onPositions = valuateOnPositions(
    onBondTrades,
    onPriceResult,
    cclRate,
    onNamesById
  );

  const rawHoldings: HoldingForDashboard[] = [
    ...equityHoldings.map((h) => ({
      instrumentId: h.instrumentId,
      ticker: h.ticker,
      instrumentName: h.instrumentName,
      instrumentType: h.instrumentType,
      quantity: h.quantity,
      costBasisArs: h.costBasisArs,
      marketValueArs: h.marketValueArs,
      pnlArs: h.pnlArs,
      pnlPercent: h.pnlPercent,
      sector: sectorByInstrument.get(h.instrumentId) ?? null,
    })),
    ...onPositions.map((p) => toDashboardHolding(p, cclRate)),
  ];

  let holdingsValueArs = new Decimal(0);
  for (const h of rawHoldings) {
    holdingsValueArs = holdingsValueArs.plus(new Decimal(h.marketValueArs));
  }

  const safeCashArs = Decimal.max(0, cashArs);
  const safeCashUsd = Decimal.max(0, cashUsd);

  const totalValueArs = holdingsValueArs
    .plus(safeCashArs)
    .plus(cclRate && cclRate > 0 ? safeCashUsd.mul(cclRate) : 0);

  const totalValueUsd =
    cclRate && cclRate > 0 ? totalValueArs.div(cclRate) : new Decimal(0);

  const positionsJson: Prisma.InputJsonValue = rawHoldings.map((h) => ({
    instrumentId: h.instrumentId,
    ticker: h.ticker,
    instrumentName: h.instrumentName,
    instrumentType: h.instrumentType,
    quantity: h.quantity,
    costBasisArs: h.costBasisArs,
    marketValueArs: h.marketValueArs,
    pnlArs: h.pnlArs,
    pnlPercent: h.pnlPercent,
  }));

  return {
    totalValueArs: totalValueArs.toNumber(),
    totalValueUsd: totalValueUsd.toNumber(),
    cashArs: safeCashArs.toNumber(),
    cashUsd: safeCashUsd.toNumber(),
    netDepositsArs: Decimal.max(0, netDepositsArs).toNumber(),
    netDepositsUsd: Decimal.max(0, netDepositsUsd).toNumber(),
    twrSinceInception: null,
    positions: positionsJson,
  };
}
