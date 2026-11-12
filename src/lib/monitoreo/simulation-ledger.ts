export type OrderSide = "buy" | "sell";

export type SimOrder = {
  id: string;
  side: OrderSide;
  /** Units of the instrument */
  quantity: number;
  /** Unit price in the displayed series' scale (before commission) */
  price: number;
};

/** What the ledger needs from a position; `PositionSummary` satisfies it. */
export type Holding = { quantity: number; avgCost: number | null };

export type LedgerStep = {
  orderId: string;
  side: OrderSide;
  /** Units actually executed (a sell larger than the holding is clamped) */
  quantity: number;
  clamped: boolean;
  price: number;
  /** Money (see `moneyFactor`): cash out for a buy (commission included) or net sell proceeds */
  cash: number;
  fee: number;
  /** Realized result of this step (sells only), net of commission */
  realized: number;
  quantityAfter: number;
  /** null once nothing is held */
  avgCostAfter: number | null;
};

export type LedgerTotals = {
  quantityBefore: number;
  quantity: number;
  avgCostBefore: number | null;
  avgCost: number | null;
  /** New PPC minus the previous one; 0 when either side has no PPC */
  avgCostChange: number;
  avgCostChangePct: number | null;
  /** Sum of buy cash (commissions included) */
  totalInvested: number;
  /** Sum of sell proceeds (net of commissions) */
  totalProceeds: number;
  totalRealized: number;
  totalFees: number;
  /** Result of what is still held vs. the reference price; null when nothing is held */
  unrealizedPct: number | null;
  /** Some sell asked for more than was held */
  clamped: boolean;
};

export type LedgerResult = { steps: LedgerStep[]; totals: LedgerTotals };

export type LedgerOptions = {
  /** Commission in percent applied to every order; invalid or negative counts as 0 */
  feePct?: number;
  referencePrice?: number | null;
  /**
   * Money per chart-scale unit of qty × price (default 1). Cash, fees, proceeds and realized
   * results are scaled by it; PPC, quantities and percentages stay in chart scale.
   */
  moneyFactor?: number;
};

const QUANTITY_EPSILON = 1e-9;

const isPositive = (n: number) => Number.isFinite(n) && n > 0;
const feeRate = (feePct: number | undefined) =>
  feePct !== undefined && Number.isFinite(feePct) && feePct > 0 ? feePct / 100 : 0;

/** Applies one order with the average-cost method (same rules as `buildPositionSummary`). */
export function applyOrder(
  state: Holding,
  order: SimOrder,
  feePct = 0,
  moneyFactor = 1
): LedgerStep {
  const rate = feeRate(feePct);
  const held = state.quantity > QUANTITY_EPSILON ? state.quantity : 0;

  if (order.side === "buy") {
    const effectivePrice = order.price * (1 + rate);
    const cash = order.quantity * effectivePrice;
    const quantityAfter = held + order.quantity;
    const avgCostAfter = ((held > 0 ? held * (state.avgCost ?? 0) : 0) + cash) / quantityAfter;
    return {
      orderId: order.id,
      side: "buy",
      quantity: order.quantity,
      clamped: false,
      price: order.price,
      cash: cash * moneyFactor,
      fee: order.quantity * order.price * rate * moneyFactor,
      realized: 0,
      quantityAfter,
      avgCostAfter,
    };
  }

  const executed = Math.min(order.quantity, held);
  const netPrice = order.price * (1 - rate);
  const avgCost = state.avgCost ?? 0;
  const remaining = held - executed;
  const closed = remaining <= QUANTITY_EPSILON;
  return {
    orderId: order.id,
    side: "sell",
    quantity: executed,
    clamped: order.quantity > held + QUANTITY_EPSILON,
    price: order.price,
    cash: executed * netPrice * moneyFactor,
    fee: executed * order.price * rate * moneyFactor,
    realized: (netPrice - avgCost) * executed * moneyFactor,
    quantityAfter: closed ? 0 : remaining,
    avgCostAfter: closed ? null : state.avgCost,
  };
}

/**
 * What-if for a sequence of buys and sells. Pure: invalid orders (≤ 0 / NaN) are skipped, and the
 * result is null when none is valid or when the open position's PPC isn't comparable.
 */
export function runSimulation(
  position: Holding | null,
  orders: SimOrder[],
  options: LedgerOptions = {}
): LedgerResult | null {
  const quantityBefore = position && position.quantity > QUANTITY_EPSILON ? position.quantity : 0;
  if (quantityBefore > 0 && (position?.avgCost == null || !Number.isFinite(position.avgCost))) {
    return null;
  }
  const avgCostBefore = quantityBefore > 0 ? position!.avgCost! : null;

  const valid = orders.filter((o) => isPositive(o.quantity) && isPositive(o.price));
  if (valid.length === 0) return null;

  const steps: LedgerStep[] = [];
  let state: Holding = { quantity: quantityBefore, avgCost: avgCostBefore };
  for (const order of valid) {
    const step = applyOrder(state, order, options.feePct, options.moneyFactor);
    steps.push(step);
    state = { quantity: step.quantityAfter, avgCost: step.avgCostAfter };
  }

  const avgCost = state.avgCost;
  const comparable = avgCostBefore !== null && avgCost !== null;
  const avgCostChange = comparable ? avgCost - avgCostBefore : 0;
  const reference = options.referencePrice;
  return {
    steps,
    totals: {
      quantityBefore,
      quantity: state.quantity,
      avgCostBefore,
      avgCost,
      avgCostChange,
      avgCostChangePct: comparable && avgCostBefore !== 0 ? (avgCostChange / avgCostBefore) * 100 : null,
      totalInvested: steps.reduce((sum, s) => sum + (s.side === "buy" ? s.cash : 0), 0),
      totalProceeds: steps.reduce((sum, s) => sum + (s.side === "sell" ? s.cash : 0), 0),
      totalRealized: steps.reduce((sum, s) => sum + s.realized, 0),
      totalFees: steps.reduce((sum, s) => sum + s.fee, 0),
      unrealizedPct:
        avgCost !== null && avgCost > 0 && reference != null && Number.isFinite(reference)
          ? ((reference - avgCost) / avgCost) * 100
          : null,
      clamped: steps.some((s) => s.clamped),
    },
  };
}
