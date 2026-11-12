import { quantityForAmount } from "./order-sizing";
import { toChartPrice } from "./price-basis";
import type { Holding } from "./simulation-ledger";

const isPositive = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

/**
 * Rise (in %) from `reference` needed to get back to the PPC. Negative when the reference is
 * already above the PPC; null when either price is unusable.
 */
export function breakEvenMovePct(reference: number | null, avgCost: number | null): number | null {
  if (!isPositive(reference) || !isPositive(avgCost)) return null;
  return ((avgCost - reference) / reference) * 100;
}

export type Scenario = {
  dropPct: number;
  /** Hypothetical market price in chart scale */
  price: number;
  /** Whole units the amount buys at that price (commission included) */
  quantity: number;
  newAvgCost: number | null;
  /** Relative PPC change in %; null when there was no previous PPC */
  avgCostChangePct: number | null;
  /** Result of the new position at that same price, in % */
  resultPct: number | null;
};

export type ScenarioOptions = {
  /** Amount to invest, in pesos per unit paid (see `moneyFactor`) */
  amount: number;
  /** Market price in the basis currency */
  marketPrice: number;
  /** Chart-scale price per basis price */
  factor: number;
  /** Pesos per chart-scale unit of qty × price; null: the amount can't be sized */
  moneyFactor: number | null;
  feePct: number;
  drops?: number[];
};

const DEFAULT_DROPS = [5, 10, 20, 30];

/**
 * "What if the market falls X % and I invest the same amount there?" for each drop. Pure; null
 * for invalid inputs or a non-comparable open position.
 */
export function scenarioTable(
  position: Holding | null,
  { amount, marketPrice, factor, moneyFactor, feePct, drops = DEFAULT_DROPS }: ScenarioOptions
): Scenario[] | null {
  if (!isPositive(amount) || !isPositive(marketPrice) || !isPositive(factor)) return null;
  if (!isPositive(moneyFactor)) return null;
  const heldQuantity = position && position.quantity > 0 ? position.quantity : 0;
  if (heldQuantity > 0 && !isPositive(position?.avgCost)) return null;
  const previousAvg = heldQuantity > 0 ? position!.avgCost! : null;
  const rate = Number.isFinite(feePct) && feePct > 0 ? feePct / 100 : 0;

  return drops.map((dropPct) => {
    const basisPrice = marketPrice * (1 - dropPct / 100);
    const price = toChartPrice(basisPrice, factor);
    const quantity = quantityForAmount(amount / moneyFactor, price, feePct)?.quantity ?? 0;
    const effective = price * (1 + rate);
    const newQuantity = heldQuantity + quantity;
    const newAvgCost =
      quantity === 0
        ? previousAvg
        : previousAvg === null
          ? effective
          : (heldQuantity * previousAvg + quantity * effective) / newQuantity;
    return {
      dropPct,
      price,
      quantity,
      newAvgCost,
      avgCostChangePct:
        newAvgCost !== null && previousAvg !== null ? ((newAvgCost - previousAvg) / previousAvg) * 100 : null,
      resultPct: newAvgCost !== null && newAvgCost > 0 ? ((price - newAvgCost) / newAvgCost) * 100 : null,
    };
  });
}
