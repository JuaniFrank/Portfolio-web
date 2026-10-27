/**
 * Cableado de producción de `evaluatePriceAlerts`: repo de Prisma, precios reales y
 * Telegram. Lo comparten la ruta de cron y el worker, para que ambos corran exactamente
 * lo mismo.
 */

import { evaluatePriceAlerts, type EvaluateSummary } from "../evaluate-price-alerts";
import { createMarketPriceSource } from "./market-price-source";
import { createPrismaPriceTargetRepo } from "./prisma-targets";
import { createTelegramNotifier } from "./telegram";

export function runPriceAlerts(now: Date = new Date()): Promise<EvaluateSummary> {
  return evaluatePriceAlerts({
    repo: createPrismaPriceTargetRepo(),
    prices: createMarketPriceSource(),
    notifier: createTelegramNotifier(),
    now,
  });
}
