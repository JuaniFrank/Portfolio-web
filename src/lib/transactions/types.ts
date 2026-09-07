import type { InstrumentType, TransactionType } from "@/lib/generated/prisma";

/** Instrumentos incluidos en resumen e historial (extensible). */
export const TRADE_INSTRUMENT_TYPES: InstrumentType[] = ["STOCK_AR", "CEDEAR", "ON"];

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
  /**
   * Costo en dólares: cada compra convertida al CCL **de su propia fecha**.
   *
   * `null` cuando no hay histórico de CCL para alguna compra. No es lo mismo que el
   * costo en pesos dividido por el CCL de hoy: esa cuenta borra el movimiento del tipo
   * de cambio y deja el rendimiento en dólares idéntico al de pesos.
   */
  costBasisUsd: string | null;
  /** Valor a mercado en dólares, al CCL de hoy. `null` sin CCL. */
  marketValueUsd: string | null;
  pnlUsd: string | null;
  pnlPercentUsd: string | null;
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
