/**
 * ISIN-based grouping for fixed income (AD-13). Pure — no Prisma, no fetch.
 *
 * Tickers sharing an ISIN are one security by definition of the standard —
 * a deterministic membership signal for BOND_AR/LETRA, where Yahoo's currency
 * oracle (AD-12) does not answer at all.
 */

export type IsinRow = {
  ticker: string;
  isin: string | null;
};

export type IsinGroup = {
  isin: string;
  tickers: string[];
};

function normalizeIsin(isin: string | null): string | null {
  if (isin === null) return null;
  const trimmed = isin.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Groups rows sharing a non-blank ISIN. Rows with a null/blank ISIN are
 * NEVER grouped together — grouping on null as if it were a shared value is
 * the most likely wrong implementation, and the whole point of an ISIN
 * group is a real, shared, published identifier.
 */
export function groupByIsin(rows: IsinRow[]): IsinGroup[] {
  const byIsin = new Map<string, string[]>();

  for (const row of rows) {
    const isin = normalizeIsin(row.isin);
    if (isin === null) continue;
    const tickers = byIsin.get(isin) ?? [];
    tickers.push(row.ticker);
    byIsin.set(isin, tickers);
  }

  return [...byIsin.entries()].map(([isin, tickers]) => ({ isin, tickers }));
}
