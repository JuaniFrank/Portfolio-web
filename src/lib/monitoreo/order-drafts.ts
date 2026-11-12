import { quantityForAmount, quantityForTargetAvgCost, type TargetSizing } from "./order-sizing";
import { toChartPrice } from "./price-basis";
import {
  applyOrder,
  runSimulation,
  type Holding,
  type LedgerResult,
  type LedgerStep,
  type OrderSide,
  type SimOrder,
} from "./simulation-ledger";

export type OrderMode = "quantity" | "amount" | "target";

/**
 * One row of the simulator as typed. Prices and the target PPC are per unit in the price basis
 * (factor-converted); the amount is money in the instrument's own currency (pesos per unit paid),
 * which relates to chart prices through `moneyFactor`.
 */
export type OrderDraft = {
  id: string;
  side: OrderSide;
  mode: OrderMode;
  quantityText: string;
  amountText: string;
  targetText: string;
  /** null: the price follows the market quote until the user types one */
  priceText: string | null;
};

export type DraftSizing =
  | { kind: "amount"; spent: number; leftover: number }
  | { kind: "target"; result: TargetSizing };

export type ResolvedDraft = {
  id: string;
  basisPrice: number | null;
  chartPrice: number | null;
  /** Units the row resolves to (typed, or derived from the amount / target); null when unknown */
  quantity: number | null;
  sizing: DraftSizing | null;
  order: SimOrder | null;
  step: LedgerStep | null;
};

export type DraftContext = {
  /** Market price in the basis, used while a row's price is untouched */
  defaultBasisPrice: number | null;
  /** Chart-scale price per basis price; null when it can't be computed */
  factor: number | null;
  /** Pesos per chart-scale unit of qty × price (`moneyFactor`); null: money can't be sized */
  moneyFactor: number | null;
  feePct: number;
  referencePrice: number | null;
};

const PLAIN_NUMBER = /^(\d+[.,]?\d*|[.,]\d+)$/;
const AR_THOUSANDS = /^\d{1,3}(\.\d{3})+(,\d+)?$/;
const EN_THOUSANDS = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

/**
 * Parses plain digits with "," or "." as the decimal separator, or thousands-grouped forms
 * ("1.234,5", "1,234.5"); NaN for anything else (hex, exponents, signs, stray characters).
 */
export function parseDecimalInput(text: string): number {
  const t = text.trim();
  if (PLAIN_NUMBER.test(t)) return Number(t.replace(",", "."));
  if (AR_THOUSANDS.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (EN_THOUSANDS.test(t)) return Number(t.replace(/,/g, ""));
  return Number.NaN;
}

export type GhostOrder = { id: string; side: OrderSide; price: number; quantity: number };

/**
 * Orders worth drawing on the chart: zero-unit orders (a fully clamped sell) are dropped and
 * same-side orders at the identical price merge into one marker (first id, summed units) so
 * they don't overlap exactly.
 */
export function ghostMarkers(orders: GhostOrder[]): GhostOrder[] {
  const merged = new Map<string, GhostOrder>();
  for (const o of orders) {
    if (!(o.quantity > 0)) continue;
    const key = `${o.side}:${o.price}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += o.quantity;
    else merged.set(key, { ...o });
  }
  return [...merged.values()];
}

export function newDraft(id: string): OrderDraft {
  return { id, side: "buy", mode: "quantity", quantityText: "", amountText: "", targetText: "", priceText: null };
}

const positiveOrNull = (n: number) => (Number.isFinite(n) && n > 0 ? n : null);

/**
 * Turns the typed rows into ledger orders (sizing amount / target rows against the holding left
 * by the rows before them) and runs the simulation. Rows that are incomplete or can't be solved
 * produce no order and leave the running holding untouched.
 */
export function resolveDrafts(
  position: Holding | null,
  drafts: OrderDraft[],
  ctx: DraftContext
): { rows: ResolvedDraft[]; result: LedgerResult | null } {
  const comparable =
    !position || !(position.quantity > 0) || (position.avgCost !== null && Number.isFinite(position.avgCost));
  let holding: Holding | null = comparable
    ? { quantity: position && position.quantity > 0 ? position.quantity : 0, avgCost: position?.avgCost ?? null }
    : null;

  const orders: SimOrder[] = [];
  const rows: ResolvedDraft[] = drafts.map((draft) => {
    const typedPrice = draft.priceText === null ? null : positiveOrNull(parseDecimalInput(draft.priceText));
    const basisPrice = draft.priceText === null ? ctx.defaultBasisPrice : typedPrice;
    const chartPrice =
      basisPrice !== null && ctx.factor !== null ? toChartPrice(basisPrice, ctx.factor) : null;

    let quantity: number | null = null;
    let sizing: DraftSizing | null = null;
    if (draft.mode === "quantity") {
      quantity = positiveOrNull(parseDecimalInput(draft.quantityText));
    } else if (draft.mode === "amount") {
      const amount = positiveOrNull(parseDecimalInput(draft.amountText));
      const sized =
        amount !== null && chartPrice !== null && ctx.moneyFactor !== null
          ? quantityForAmount(amount / ctx.moneyFactor, chartPrice, ctx.feePct, draft.side)
          : null;
      if (sized && ctx.moneyFactor !== null) {
        sizing = {
          kind: "amount",
          spent: sized.spent * ctx.moneyFactor,
          leftover: sized.leftover * ctx.moneyFactor,
        };
        quantity = sized.quantity > 0 ? sized.quantity : null;
      }
    } else {
      const target = positiveOrNull(parseDecimalInput(draft.targetText));
      if (target !== null && chartPrice !== null && ctx.factor !== null) {
        const result: TargetSizing =
          draft.side === "sell"
            ? { ok: false, reason: "invalid" }
            : holding === null
              ? { ok: false, reason: "not-comparable" }
              : quantityForTargetAvgCost(holding, toChartPrice(target, ctx.factor), chartPrice, ctx.feePct);
        sizing = { kind: "target", result };
        quantity = result.ok ? result.quantity : null;
        if (result.ok && ctx.moneyFactor !== null) result.cost *= ctx.moneyFactor;
      }
    }

    const order: SimOrder | null =
      quantity !== null && chartPrice !== null
        ? { id: draft.id, side: draft.side, quantity, price: chartPrice }
        : null;
    if (order) {
      orders.push(order);
      if (holding) {
        const step = applyOrder(holding, order, ctx.feePct, ctx.moneyFactor ?? 1);
        holding = { quantity: step.quantityAfter, avgCost: step.avgCostAfter };
      }
    }
    return { id: draft.id, basisPrice, chartPrice, quantity, sizing, order, step: null };
  });

  const result = runSimulation(position, orders, {
    feePct: ctx.feePct,
    referencePrice: ctx.referencePrice,
    moneyFactor: ctx.moneyFactor ?? 1,
  });
  if (result) {
    const stepById = new Map(result.steps.map((s) => [s.orderId, s]));
    for (const row of rows) row.step = stepById.get(row.id) ?? null;
  }
  return { rows, result };
}
