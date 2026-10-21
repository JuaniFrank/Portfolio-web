/**
 * Posiciones cuyo precio no es una cotización fresca. **Módulo puro.**
 *
 * Un precio que falla en silencio es peor que un error visible: sin cotización una
 * posición se valúa a costo (P&L exactamente 0) y el usuario cree que ese 0 es real.
 * Acá se separa qué cayó a costo de qué se resolvió con un precio viejo del caché.
 */

export type PriceIssues = {
  /** Sin ningún precio disponible: valuadas a costo, P&L 0 por construcción. */
  valuedAtCost: string[];
  /** La cotización en vivo falló y se usó el último precio guardado. */
  stale: string[];
};

export const NO_PRICE_ISSUES: PriceIssues = { valuedAtCost: [], stale: [] };

const byTicker = (a: string, b: string) => a.localeCompare(b);

/**
 * Un ticker vendido por completo no tiene posición que valuar: sin esto, uno sin cotización
 * figuraría como "valuado a costo". `holdings` son las filas de `buildHoldings` (solo qty > 0).
 */
export function onlyHeldInstruments<T extends { id: string }>(
  instruments: readonly T[],
  holdings: ReadonlyArray<{ instrumentId: string }>
): T[] {
  const held = new Set(holdings.map((h) => h.instrumentId));
  return instruments.filter((i) => held.has(i.id));
}

/**
 * Cruza el resultado de `refreshLatestQuotes` con los instrumentos pedidos.
 * `failedIds` son los que fallaron el fetch en vivo, tengan o no caché de respaldo.
 */
export function classifyQuoteCoverage(
  instruments: ReadonlyArray<{ id: string; ticker: string }>,
  prices: ReadonlyMap<string, string>,
  failedIds: readonly string[]
): PriceIssues {
  const failed = new Set(failedIds);
  const valuedAtCost: string[] = [];
  const stale: string[] = [];

  for (const instrument of instruments) {
    if (!prices.has(instrument.id)) valuedAtCost.push(instrument.ticker);
    else if (failed.has(instrument.id)) stale.push(instrument.ticker);
  }

  return { valuedAtCost: valuedAtCost.sort(byTicker), stale: stale.sort(byTicker) };
}

/** Las ONs ya traen sus propios flags desde `valuateOnPositions`. */
export function onPriceIssues(
  positions: ReadonlyArray<{ ticker: string; priceUnavailable: boolean; priceStale: boolean }>
): PriceIssues {
  return {
    valuedAtCost: positions.filter((p) => p.priceUnavailable).map((p) => p.ticker).sort(byTicker),
    stale: positions.filter((p) => !p.priceUnavailable && p.priceStale).map((p) => p.ticker).sort(byTicker),
  };
}

export function mergePriceIssues(...parts: PriceIssues[]): PriceIssues {
  const union = (pick: (issues: PriceIssues) => string[]) =>
    [...new Set(parts.flatMap(pick))].sort(byTicker);
  return { valuedAtCost: union((p) => p.valuedAtCost), stale: union((p) => p.stale) };
}
