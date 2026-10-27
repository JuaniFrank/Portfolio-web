/** Configuración pura del worker de alertas (ver `scripts/price-alerts-worker.ts`). */

export const DEFAULT_INTERVAL_MINUTES = 10;

/** Minutos entre corridas a partir de `PRICE_ALERTS_INTERVAL_MINUTES`; inválido → 10. */
export function parseIntervalMinutes(raw: string | undefined): number {
  const value = Number(raw?.trim());
  return raw !== undefined && raw.trim() !== "" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_INTERVAL_MINUTES;
}
