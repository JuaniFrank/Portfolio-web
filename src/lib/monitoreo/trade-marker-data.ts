import type { TradeMarkerInput } from "@/lib/monitoreo/trade-markers";
import type { AdjustmentEvent } from "@/lib/monitoreo/types";

/**
 * Trades (BUY/SELL only) and corporate event dates for one instrument, scoped to the
 * current user's default portfolio, plus the inputs needed to project trade prices into the
 * displayed series' scale. Decimal/Date fields are already serialized to plain number/string
 * since the marker modules take no Prisma types.
 */
export type TradeMarkerData = {
  trades: TradeMarkerInput[];
  corporateEventDates: string[];
  /** The same events with their price ratio (ticker changes and degenerate ratios excluded) */
  corporateEvents: AdjustmentEvent[];
  /** The instrument's own ARS EOD closes around the trade dates (sorted, deduped) */
  nativeArsCloses: { date: string; close: number }[];
  /** CCL rates around the trade dates (sorted, deduped) */
  cclByDate: { date: string; rate: number }[];
};

/** No trades and no projection inputs (also the degraded value when the request fails). */
export const EMPTY_TRADE_MARKER_DATA: TradeMarkerData = {
  trades: [],
  corporateEventDates: [],
  corporateEvents: [],
  nativeArsCloses: [],
  cclByDate: [],
};
