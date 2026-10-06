import Decimal from "decimal.js";

export type TradeAmountsInput = {
  side: "BUY" | "SELL";
  quantity: string;
  price: string;
  fees?: string;
  taxes?: string;
  /** Only present when editing an imported row that already carries it. */
  marketRights?: string;
};

export type TradeAmounts = {
  grossAmount: string;
  fees: string;
  taxes: string;
  marketRights: string;
  netAmount: string;
};

/**
 * Gross and net amounts of a BUY/SELL, shared by create and edit.
 * Cash out of pocket on a buy adds costs; proceeds on a sell net them out.
 */
export function computeTradeAmounts(input: TradeAmountsInput): TradeAmounts {
  const quantity = new Decimal(input.quantity);
  const price = new Decimal(input.price);
  const fees = new Decimal(input.fees ?? "0");
  const taxes = new Decimal(input.taxes ?? "0");
  const marketRights = new Decimal(input.marketRights ?? "0");
  const grossAmount = quantity.mul(price);
  const costs = fees.plus(taxes).plus(marketRights);
  const netAmount = input.side === "BUY" ? grossAmount.plus(costs) : grossAmount.minus(costs);

  return {
    grossAmount: grossAmount.toString(),
    fees: fees.toString(),
    taxes: taxes.toString(),
    marketRights: marketRights.toString(),
    netAmount: netAmount.toString(),
  };
}
