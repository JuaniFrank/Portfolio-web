/** Texto de la notificación cuando un objetivo se cumple. Puro: ver `message.test.ts`. */

import type { AlertTarget } from "./types";

const numberFormat = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPrice(value: number, currency: string): string {
  return `${currency} ${numberFormat.format(value)}`;
}

export function formatAlertMessage(target: AlertTarget, price: number): string {
  const side = target.direction === "ABOVE" ? "por encima de" : "por debajo de";
  const subject =
    target.symbol && target.symbol !== target.ticker
      ? `${target.ticker} (acción original ${target.symbol})`
      : target.ticker;

  const lines = [
    `Objetivo alcanzado: ${subject}`,
    `Precio actual ${formatPrice(price, target.currency)}, ${side} tu objetivo de ${formatPrice(target.targetPrice, target.currency)}.`,
  ];
  if (target.note) lines.push(`Nota: ${target.note}`);
  return lines.join("\n");
}
