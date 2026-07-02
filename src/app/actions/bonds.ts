"use server";

import { getCurrentUser } from "@/lib/auth";
import { buildBondsPageData, type TradeForBonds } from "@/lib/bonds/build";
import type { BondsPageData } from "@/lib/bonds/types";
import { fetchOnPrices } from "@/lib/market/data912";
import { fetchCclQuote } from "@/lib/market/dolarapi";
import { prisma } from "@/lib/prisma";
import { TransactionType } from "@/lib/generated/prisma";

export async function getBondsPageDataAction(): Promise<
  BondsPageData | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  // Query all ON transactions — scoped exclusively to instrumentType "ON".
  // TRADE_INSTRUMENT_TYPES is intentionally not touched here.
  const txRows = await prisma.transaction.findMany({
    where: {
      portfolio: { userId: user.id },
      type: {
        in: [
          TransactionType.BUY,
          TransactionType.SELL,
          TransactionType.COUPON,
          TransactionType.AMORTIZATION,
        ],
      },
      instrument: { type: "ON" },
      instrumentId: { not: null },
    },
    orderBy: { tradeDate: "asc" },
    include: {
      instrument: { select: { id: true, ticker: true, type: true } },
    },
  });

  // Collect unique tickers for the price fetch
  const tickers = Array.from(
    new Set(
      txRows
        .filter((r) => r.instrument !== null)
        .map((r) => r.instrument!.ticker.toUpperCase())
    )
  );

  const [priceResult, cclQuote] = await Promise.all([
    fetchOnPrices(tickers),
    fetchCclQuote(),
  ]);

  const cclMid = cclQuote?.mid ?? null;

  // Map Prisma rows to the shape expected by buildBondsPageData.
  // The TradeForBonds intersection type constrains `.type` to "BUY"|"SELL" (from TradeForBondHoldings),
  // but buildBondsPageData already partitions BUY/SELL rows from COUPON/AMORTIZATION rows internally.
  // We cast via unknown because the intersection narrows the type field too aggressively; the runtime
  // contract is satisfied — buildBondHoldings filters for BUY/SELL, aggregateReceivedFlows for
  // COUPON/AMORTIZATION, and neither function crashes on unexpected type values.
  const trades = txRows
    .filter((r) => r.instrument !== null)
    .map((r) => ({
      instrumentId: r.instrument!.id,
      ticker: r.instrument!.ticker,
      type: r.type,
      quantity: r.quantity.toString(),
      netAmount: r.netAmount.toString(),
      currencyCode: r.currencyCode,
      tradeDate: r.tradeDate.toISOString(),
    })) as unknown as TradeForBonds[];

  return buildBondsPageData(trades, priceResult, cclMid);
}
