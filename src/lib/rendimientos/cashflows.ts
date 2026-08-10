/**
 * Clasificación de flujos de caja. **Módulo puro.**
 *
 * Este archivo existe porque confundir un flujo externo con uno interno es el error
 * número uno en todo cálculo de rendimiento de cartera, y es exactamente el error que
 * tenía la versión anterior de /rendimientos.
 *
 * Un **flujo externo** es plata que entra o sale del portfolio. Cambia el capital
 * sobre el que se mide, así que hay que descontarlo del rendimiento.
 *
 * Un **flujo interno** reasigna o genera valor dentro del portfolio. NO se descuenta:
 *   - `BUY` / `SELL` convierten efectivo en activo y viceversa. El valor total no se
 *     mueve. Contar una compra como aporte es lo que hacía que un mes de compras
 *     apareciera como un rendimiento inventado.
 *   - `DIVIDEND_CASH`, `COUPON`, `AMORTIZATION`, `INTEREST` son **retorno generado**
 *     por la cartera. Descontarlos borraría justamente la ganancia que hay que medir.
 *   - `FEE`, `TAX_WITHHOLDING` son costos que deben impactar el rendimiento a la baja.
 *   - `FX_CONVERSION` cambia la composición por moneda, no el valor total.
 */

import type { TransactionType } from "@/lib/generated/prisma";

/** Los únicos tipos que mueven capital hacia adentro o afuera del portfolio. */
export const EXTERNAL_FLOW_TYPES: readonly TransactionType[] = [
  "DEPOSIT",
  "WITHDRAWAL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;

const EXTERNAL_FLOW_SET = new Set<TransactionType>(EXTERNAL_FLOW_TYPES);

/** Tipos que suman capital; el resto de los externos lo restan. */
const INBOUND_TYPES = new Set<TransactionType>(["DEPOSIT", "TRANSFER_IN"]);

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

export function isExternalFlow(type: TransactionType): boolean {
  return EXTERNAL_FLOW_SET.has(type);
}

export type TransactionForFlows = {
  type: TransactionType;
  tradeDate: Date;
  /** Monto neto del movimiento. Se usa su valor absoluto; el signo lo fija el tipo. */
  netAmount: number;
  currencyCode: string;
};

export type ClassifiedFlow = {
  date: Date;
  /** Positivo = aporte, negativo = retiro. */
  amount: number;
  /** Moneda nativa del movimiento. */
  currency: "ARS" | "USD";
};

/**
 * Convierte transacciones en flujos externos con signo, descartando todo lo interno.
 *
 * Se toma `Math.abs(netAmount)` a propósito: distintos importadores registran el signo
 * de forma inconsistente (algunos ponen los retiros en negativo, otros no). El único
 * dato en el que confiamos para el signo es el `type`.
 */
export function classifyExternalFlows(
  transactions: TransactionForFlows[]
): ClassifiedFlow[] {
  const flows: ClassifiedFlow[] = [];

  for (const tx of transactions) {
    if (!isExternalFlow(tx.type)) continue;
    if (!Number.isFinite(tx.netAmount)) continue;

    const magnitude = Math.abs(tx.netAmount);
    if (magnitude === 0) continue;

    flows.push({
      date: tx.tradeDate,
      amount: INBOUND_TYPES.has(tx.type) ? magnitude : -magnitude,
      currency: isUsdCurrency(tx.currencyCode) ? "USD" : "ARS",
    });
  }

  return flows.sort((a, b) => a.date.getTime() - b.date.getTime());
}
