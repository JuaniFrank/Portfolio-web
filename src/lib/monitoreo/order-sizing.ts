import type { Holding, OrderSide } from "./simulation-ledger";

/** Absorbs floating point noise so e.g. 0.3 / 0.1 still counts as 3 whole units. */
const EPSILON = 1e-9;

const isPositive = (n: number) => Number.isFinite(n) && n > 0;
const feeRate = (feePct: number) => (Number.isFinite(feePct) && feePct > 0 ? feePct / 100 : 0);

export type AmountSizing = {
  /** Whole units that fit in the amount */
  quantity: number;
  /** quantity × per-unit cash (commission included) */
  spent: number;
  leftover: number;
};

/**
 * Whole units an amount buys (per-unit cost = price × (1 + fee)) or, for a sell, how many units
 * raise about that amount (per-unit net = price × (1 − fee)). Amount and price share a currency.
 */
export function quantityForAmount(
  amount: number,
  price: number,
  feePct: number,
  side: OrderSide = "buy"
): AmountSizing | null {
  if (!isPositive(amount) || !isPositive(price)) return null;
  const rate = feeRate(feePct);
  const unit = side === "buy" ? price * (1 + rate) : price * (1 - rate);
  if (!isPositive(unit)) return null;
  const quantity = Math.floor(amount / unit + EPSILON);
  const spent = quantity * unit;
  return { quantity, spent, leftover: Math.max(0, amount - spent) };
}

export type TargetSizingFailure =
  | "invalid"
  | "no-position"
  | "not-comparable"
  | "already-at-target"
  /** The buy price sits on the other side of the PPC, so buying can't move it toward the target */
  | "wrong-direction"
  /** The target is at or beyond the effective buy price: the PPC only approaches it asymptotically */
  | "unreachable";

export type TargetSizing =
  | { ok: true; quantity: number; resultingAvgCost: number; cost: number }
  | { ok: false; reason: TargetSizingFailure };

/**
 * Whole units to buy at `price` so the blended PPC reaches `target`: solves
 * (Q·A + n·e) / (Q + n) = T for n with e the effective (commission-included) price, rounded up so
 * the target is met or passed. Target and price share the chart scale.
 */
export function quantityForTargetAvgCost(
  position: Holding | null,
  target: number,
  price: number,
  feePct: number
): TargetSizing {
  if (!isPositive(target) || !isPositive(price)) return { ok: false, reason: "invalid" };
  if (!position || !(position.quantity > EPSILON)) return { ok: false, reason: "no-position" };
  const avg = position.avgCost;
  if (avg === null || !Number.isFinite(avg)) return { ok: false, reason: "not-comparable" };
  if (target === avg) return { ok: false, reason: "already-at-target" };

  const effective = price * (1 + feeRate(feePct));
  if (effective === avg) return { ok: false, reason: "unreachable" };
  const lowering = effective < avg;
  if (lowering ? target > avg : target < avg) return { ok: false, reason: "wrong-direction" };
  if (lowering ? target <= effective : target >= effective) return { ok: false, reason: "unreachable" };

  const raw = (position.quantity * (avg - target)) / (target - effective);
  const quantity = Math.max(1, Math.ceil(raw - EPSILON));
  const cost = quantity * effective;
  return {
    ok: true,
    quantity,
    cost,
    resultingAvgCost: (position.quantity * avg + cost) / (position.quantity + quantity),
  };
}
