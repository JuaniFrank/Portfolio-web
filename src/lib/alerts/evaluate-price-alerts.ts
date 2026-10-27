/**
 * Caso de uso: evalúa los objetivos de precio pendientes y avisa los que se cumplen.
 *
 * Lo usan por igual la ruta de cron y el worker; recibe todo por puertos (repo, precios,
 * notificador y reloj), así que se prueba con fakes (ver `evaluate-price-alerts.test.ts`).
 *
 * Reglas:
 * - Un objetivo armado (`triggeredAt == null`) cuyo precio cumple la condición se marca
 *   como disparado **una sola vez**, con el precio que lo disparó.
 * - `notifiedAt` se marca solo si el envío salió bien. Si el canal no está configurado o
 *   el envío falla, el objetivo queda disparado sin notificar y la corrida siguiente
 *   reintenta el aviso (sin volver a dispararlo y con el precio original).
 * - Un fallo en un objetivo no corta a los demás.
 */

import { evaluate, isArmed } from "./evaluate";
import { formatAlertMessage } from "./message";
import type { Notifier, PriceSource, PriceTargetRepo } from "./ports";
import type { AlertTarget, PriceRequest } from "./types";

export type EvaluateSummary = {
  /** Objetivos armados considerados en esta corrida (incluye los sin precio). */
  evaluated: number;
  /** De ellos, los que no tuvieron precio disponible. */
  missingPrice: number;
  triggered: number;
  notified: number;
  /** Avisos que no salieron porque el canal no está configurado. */
  skipped: number;
  failed: number;
};

export async function evaluatePriceAlerts(deps: {
  repo: PriceTargetRepo;
  prices: PriceSource;
  notifier: Notifier;
  now: Date;
}): Promise<EvaluateSummary> {
  const { repo, prices, notifier, now } = deps;
  const summary: EvaluateSummary = {
    evaluated: 0,
    missingPrice: 0,
    triggered: 0,
    notified: 0,
    skipped: 0,
    failed: 0,
  };

  const pending = (await repo.listPending()).filter((target) => target.notifiedAt === null);
  if (pending.length === 0) return summary;

  const armed = pending.filter(isArmed);
  const priceByInstrument = armed.length > 0 ? await prices.resolve(requestsFor(armed)) : new Map<string, number>();

  for (const target of pending) {
    try {
      let price: number;
      if (isArmed(target)) {
        summary.evaluated += 1;
        const current = priceByInstrument.get(target.instrumentId);
        if (current === undefined) {
          summary.missingPrice += 1;
          continue;
        }
        if (!evaluate(target, current)) continue;

        // Si otra corrida lo disparó antes (o se re-armó), no se avisa de nuevo.
        if (!(await repo.markTriggered(target.id, current, now))) continue;
        summary.triggered += 1;
        price = current;
      } else {
        // Disparado en una corrida anterior cuyo aviso no salió: se reintenta con el
        // precio que lo disparó, no con el de ahora.
        if (target.triggeredPrice === null) continue;
        price = target.triggeredPrice;
      }

      const result = await notifier.send(formatAlertMessage(target, price)).catch(
        (error: unknown) => ({ status: "failed" as const, error: String(error) })
      );
      if (result.status === "sent") {
        if (await repo.markNotified(target.id, now)) summary.notified += 1;
      } else if (result.status === "skipped") {
        summary.skipped += 1;
      } else {
        summary.failed += 1;
      }
    } catch (error) {
      console.error(`Price alert ${target.id} failed`, error);
      summary.failed += 1;
    }
  }

  return summary;
}

/** Un pedido por instrumento: varios objetivos del mismo papel comparten el precio. */
function requestsFor(targets: AlertTarget[]): PriceRequest[] {
  const byInstrument = new Map<string, PriceRequest>();
  for (const target of targets) {
    if (byInstrument.has(target.instrumentId)) continue;
    byInstrument.set(target.instrumentId, {
      instrumentId: target.instrumentId,
      currency: target.currency,
      symbol: target.symbol,
    });
  }
  return [...byInstrument.values()];
}
