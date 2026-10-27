/**
 * Reglas puras de los objetivos de precio: cuándo se cumple uno, cuándo está armado y
 * en qué estado se muestra. Sin Prisma, sin reloj y sin red (ver `evaluate.test.ts`).
 */

import type { AlertCurrency, TargetCondition } from "./types";

/**
 * `true` si el precio cumple el objetivo. Es inclusivo: `ABOVE` dispara con
 * `precio >= objetivo` y `BELOW` con `precio <= objetivo`. Sin un precio finito y
 * positivo nunca dispara: la ausencia de dato (o un 0 de una fuente rota) no es una señal.
 */
export function evaluate(target: TargetCondition, price: number | null | undefined): boolean {
  if (price === null || price === undefined || !Number.isFinite(price) || price <= 0) return false;
  return target.direction === "ABOVE" ? price >= target.targetPrice : price <= target.targetPrice;
}

/** Un objetivo está armado hasta que se dispara; se vuelve a armar limpiando `triggeredAt`. */
export function isArmed(target: { triggeredAt: Date | null }): boolean {
  return target.triggeredAt === null;
}

/**
 * Cuánto le falta al precio para llegar al objetivo, en % del precio actual. Positivo si
 * hay que subir, negativo si hay que bajar (o si ya se pasó). `null` sin precio válido.
 */
export function distanceToTargetPct(price: number | null, targetPrice: number): number | null {
  if (price === null || !Number.isFinite(price) || price <= 0) return null;
  return (targetPrice / price - 1) * 100;
}

export type TargetStatus = "armed" | "reached" | "triggered";

/**
 * - `triggered`: el worker ya lo disparó (queda así hasta que se lo rearme).
 * - `reached`: sigue armado pero el precio de ahora ya cumple la condición.
 * - `armed`: todavía no se cumple, o no hay precio.
 */
export function targetStatus(
  target: TargetCondition & { triggeredAt: Date | null },
  price: number | null
): TargetStatus {
  if (!isArmed(target)) return "triggered";
  return evaluate(target, price) ? "reached" : "armed";
}

/** Algún objetivo en la misma moneda que el precio está cumplido ahora mismo. */
export function hasReachedTarget(
  targets: Array<TargetCondition & { currency: AlertCurrency }>,
  price: number | null,
  currency: AlertCurrency
): boolean {
  return targets.some((target) => target.currency === currency && evaluate(target, price));
}

/**
 * Base de comparación (y moneda) de un objetivo según el tipo de instrumento, o `null` si
 * ese tipo no admite objetivos. Es la misma base que "Ventas realizadas": CEDEAR → la
 * acción original en USD; acción local → el propio papel en ARS.
 */
export function basisForInstrumentType(type: string): AlertCurrency | null {
  if (type === "CEDEAR") return "USD";
  if (type === "STOCK_AR") return "ARS";
  return null;
}
