import { isUsdCurrency } from "@/lib/rendimientos/cashflows";

/** CCL (USD/ARS) as of a date, or null when the history does not reach that far back. */
export type TradeCclLookup = (date: Date) => number | null;

export type TradeCurrencyInput = {
  netAmount: string;
  currencyCode: string;
  tradeDate: Date | string;
};

export type TradeInArs = {
  /** Net amount in ARS, as a string ready for `TradeForHoldings.netAmount`. */
  netAmount: string;
  /** Net amount exactly as stored, in the transaction's own currency. */
  rawNetAmount: number;
  isUsd: boolean;
  /** CCL of the trade date (ARS trades included); null when none was available. */
  rate: number | null;
};

/**
 * Express a trade's net amount in ARS.
 *
 * The position replay (`computePositionFromTrades`) assumes ARS, so a USD-denominated
 * trade has to be converted before entering it, at the CCL of its own trade date.
 * ARS trades come back untouched (same string). Without a CCL for the date the raw
 * amount is kept as a last resort instead of dropping the trade.
 */
export function convertTradeToArs(
  trade: TradeCurrencyInput,
  cclAt: TradeCclLookup
): TradeInArs {
  const rawNetAmount = Number(trade.netAmount);
  const isUsd = isUsdCurrency(trade.currencyCode);
  const found = cclAt(new Date(trade.tradeDate));
  const rate = found !== null && found > 0 ? found : null;
  const converted = isUsd && rate !== null ? (rawNetAmount * rate).toString() : trade.netAmount;
  return { netAmount: converted, rawNetAmount, isUsd, rate };
}
