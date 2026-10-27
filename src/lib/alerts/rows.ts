/**
 * Filas de la pantalla de alertas: cada objetivo con su precio actual, su distancia y su
 * estado, ya en tipos serializables (fechas en ISO) para cruzar al componente cliente.
 */

import { distanceToTargetPct, targetStatus, type TargetStatus } from "./evaluate";
import type { AlertTarget } from "./types";

export type TargetRowDTO = {
  id: string;
  instrumentId: string;
  ticker: string;
  instrumentName: string;
  symbol: string;
  currency: AlertTarget["currency"];
  direction: AlertTarget["direction"];
  targetPrice: number;
  note: string | null;
  /** Precio actual en la moneda del objetivo; `null` si no se pudo resolver. */
  price: number | null;
  /** Lo que falta para llegar al objetivo, en % del precio actual. */
  distancePct: number | null;
  status: TargetStatus;
  triggeredAt: string | null;
  triggeredPrice: number | null;
  /** El aviso ya salió (Telegram). Un disparado sin notificar se reintenta. */
  notified: boolean;
};

export function buildTargetRows(
  targets: Array<AlertTarget & { instrumentName: string }>,
  prices: Map<string, number>
): TargetRowDTO[] {
  return targets.map((target) => {
    const price = prices.get(target.instrumentId) ?? null;
    return {
      id: target.id,
      instrumentId: target.instrumentId,
      ticker: target.ticker,
      instrumentName: target.instrumentName,
      symbol: target.symbol,
      currency: target.currency,
      direction: target.direction,
      targetPrice: target.targetPrice,
      note: target.note,
      price,
      distancePct: distanceToTargetPct(price, target.targetPrice),
      status: targetStatus(target, price),
      triggeredAt: target.triggeredAt?.toISOString() ?? null,
      triggeredPrice: target.triggeredPrice,
      notified: target.notifiedAt !== null,
    };
  });
}
