/**
 * Puertos del caso de uso `evaluatePriceAlerts`. Los adaptadores reales (Prisma, Yahoo y
 * data912, Telegram) viven en `adapters/`; los tests usan fakes.
 */

import type { AlertTarget, PriceRequest } from "./types";

/** Resuelve el precio actual por instrumento. Un precio no disponible no figura en el mapa. */
export interface PriceSource {
  resolve(requests: PriceRequest[]): Promise<Map<string, number>>;
}

export type NotifyResult =
  | { status: "sent" }
  /** El canal no está configurado: no es un error, y el objetivo se reintenta después. */
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export interface Notifier {
  send(message: string): Promise<NotifyResult>;
}

export interface PriceTargetRepo {
  /** Objetivos con aviso pendiente: armados, o disparados cuya notificación no salió. */
  listPending(): Promise<AlertTarget[]>;
  /**
   * Marca el disparo solo si el objetivo sigue armado. `false` si no se aplicó (otra
   * corrida ya lo disparó, o se re-armó o borró mientras tanto).
   */
  markTriggered(id: string, price: number, at: Date): Promise<boolean>;
  /** Marca el aviso solo si estaba disparado y sin avisar. `false` si no se aplicó. */
  markNotified(id: string, at: Date): Promise<boolean>;
}
