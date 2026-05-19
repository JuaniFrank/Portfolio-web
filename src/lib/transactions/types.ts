import type { InstrumentType, TransactionType } from "@/lib/generated/prisma";

/** Instrumentos incluidos en resumen e historial (extensible). */
export const TRADE_INSTRUMENT_TYPES: InstrumentType[] = ["STOCK_AR", "CEDEAR"];

export const TRADE_TYPES: TransactionType[] = ["BUY", "SELL"];

export type TradeHistoryRow = {
  id: string;
  tradeDate: string;
  type: TransactionType;
  ticker: string;
  instrumentType: InstrumentType;
  instrumentName: string;
  quantity: string;
  priceArs: string;
  priceUsd: string | null;
  /** Monto de la operación (|netAmount| del movimiento). */
  amountArs: string;
  amountUsd: string | null;
  currencyCode: string;
  tagLabel: string | null;
  source: string;
};

export type HoldingRow = {
  instrumentId: string;
  ticker: string;
  instrumentType: InstrumentType;
  instrumentName: string;
  quantity: string;
  avgPriceArs: string;
  /** Costo en cartera: suma de lo gastado en compras menos costo liberado en ventas. */
  costBasisArs: string;
  currentPriceArs: string;
  pnlArs: string;
  pnlPercent: string;
  marketValueArs: string;
};

export type TransactionsPageData = {
  holdings: HoldingRow[];
  trades: TradeHistoryRow[];
  summary: {
    totalValueArs: string;
    totalCostArs: string;
    totalPnlArs: string;
    totalPnlPercent: string;
    cclRate: string | null;
  };
};
