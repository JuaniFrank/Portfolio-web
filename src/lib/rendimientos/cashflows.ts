/**
 * Clasificación de movimientos. **Módulo puro.**
 *
 * El perímetro que mide este motor es **el capital invertido en activos**, no la cuenta
 * del broker. Esa decisión es la que hace que el cálculo funcione sin depender de que
 * el usuario cargue sus depósitos:
 *
 *   - Una **compra ya es la prueba de que entró plata**. Si compraste $1.000 de un
 *     ticker, invertiste $1.000, haya o no un `DEPOSIT` cargado.
 *   - Una **venta saca capital** del perímetro. Vender no genera rendimiento: si vendés
 *     a lo que valía, ese mes da 0 % y la ganancia ya quedó registrada en el mes en que
 *     el precio subió.
 *   - Los **depósitos, retiros y transferencias se ignoran por completo**. Mover plata
 *     entre tu banco y el broker no cambia cuánto rindieron tus activos, y depender de
 *     esos registros hacía que dos usuarios con la misma cartera vieran rendimientos
 *     distintos según qué tan prolijos fueran cargando movimientos.
 *
 * La renta que generan las posiciones (dividendos, cupones, intereses) **no es un
 * aporte**: es justamente el retorno que hay que medir. Se acumula dentro del perímetro
 * en vez de tratarse como salida de capital — si se ignorara, la ganancia quedaría
 * subestimada. Las comisiones e impuestos entran con signo negativo por el mismo motivo,
 * al revés: son costos que tienen que empujar el rendimiento hacia abajo.
 */

import type { TransactionType } from "@/lib/generated/prisma";

/** Tipos que mueven capital hacia o desde las posiciones. */
export const CAPITAL_FLOW_TYPES: readonly TransactionType[] = ["BUY", "SELL"] as const;

/** Tipos que representan renta generada por las posiciones, o costos sobre ellas. */
export const INCOME_TYPES: readonly TransactionType[] = [
  "DIVIDEND_CASH",
  "COUPON",
  "AMORTIZATION",
  "INTEREST",
  "FEE",
  "TAX_WITHHOLDING",
] as const;

const CAPITAL_FLOW_SET = new Set<TransactionType>(CAPITAL_FLOW_TYPES);
const INCOME_SET = new Set<TransactionType>(INCOME_TYPES);

/** Renta que suma; el resto de los tipos de renta (comisiones, impuestos) resta. */
const POSITIVE_INCOME = new Set<TransactionType>([
  "DIVIDEND_CASH",
  "COUPON",
  "AMORTIZATION",
  "INTEREST",
]);

/**
 * Códigos de moneda que tratamos como USD.
 *
 * Los brokers argentinos reportan varias especies para el mismo dólar (MEP, cable) y
 * las stablecoins son equivalentes a fines de valuación.
 */
export const USD_CURRENCY_CODES: readonly string[] = [
  "USD",
  "USD_MEP",
  "USD_CABLE",
  "USDT",
  "USDC",
] as const;

const USD_CURRENCY_SET = new Set(USD_CURRENCY_CODES);

export function isUsdCurrency(currencyCode: string): boolean {
  return USD_CURRENCY_SET.has(currencyCode.toUpperCase());
}

/** ¿Mueve capital hacia/desde las posiciones? */
export function isCapitalFlow(type: TransactionType): boolean {
  return CAPITAL_FLOW_SET.has(type);
}

/** ¿Es renta generada por las posiciones, o un costo sobre ellas? */
export function isIncome(type: TransactionType): boolean {
  return INCOME_SET.has(type);
}

export type TransactionForFlows = {
  type: TransactionType;
  tradeDate: Date;
  /** Monto neto del movimiento. Se usa su valor absoluto; el signo lo fija el tipo. */
  netAmount: number;
  currencyCode: string;
  /**
   * Si el instrumento del movimiento entra en el cálculo de rendimientos.
   *
   * Los movimientos sin instrumento, o de instrumentos excluidos (renta fija, cripto),
   * quedan afuera: un cupón de una ON no puede sumar renta a un perímetro del que la ON
   * ni siquiera forma parte.
   */
  instrumentEligible: boolean;
};

export type MonetaryEvent = {
  date: Date;
  /** Capital: positivo = compra, negativo = venta. Renta: positivo = cobro, negativo = costo. */
  amount: number;
  currency: "ARS" | "USD";
};

/**
 * Capital invertido: compras en positivo, ventas en negativo.
 *
 * Es el equivalente a los "aportes" del enfoque anterior, pero derivado de las
 * operaciones en vez de los depósitos, así que siempre está disponible.
 */
export function classifyCapitalFlows(
  transactions: TransactionForFlows[]
): MonetaryEvent[] {
  return collect(transactions, (tx) =>
    isCapitalFlow(tx.type) ? (tx.type === "BUY" ? 1 : -1) : null
  );
}

/** Renta generada por las posiciones, neta de comisiones e impuestos. */
export function classifyIncome(transactions: TransactionForFlows[]): MonetaryEvent[] {
  return collect(transactions, (tx) =>
    isIncome(tx.type) ? (POSITIVE_INCOME.has(tx.type) ? 1 : -1) : null
  );
}

/**
 * Se toma `Math.abs(netAmount)` a propósito: distintos importadores registran el signo
 * de forma inconsistente (algunos ponen las ventas en negativo, otros no). El único dato
 * en el que confiamos para el signo es el `type`.
 */
function collect(
  transactions: TransactionForFlows[],
  sign: (tx: TransactionForFlows) => 1 | -1 | null
): MonetaryEvent[] {
  const events: MonetaryEvent[] = [];

  for (const tx of transactions) {
    if (!tx.instrumentEligible) continue;
    if (!Number.isFinite(tx.netAmount)) continue;

    const direction = sign(tx);
    if (direction === null) continue;

    const magnitude = Math.abs(tx.netAmount);
    if (magnitude === 0) continue;

    events.push({
      date: tx.tradeDate,
      amount: direction * magnitude,
      currency: isUsdCurrency(tx.currencyCode) ? "USD" : "ARS",
    });
  }

  return events.sort((a, b) => a.date.getTime() - b.date.getTime());
}
