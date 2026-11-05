const DAY_MS = 24 * 3600 * 1000;

const shiftDays = (isoDate: string, days: number): string =>
  new Date(Date.parse(`${isoDate}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Inclusive date range that covers every `[tradeDate - windowDays, tradeDate]` window, so a
 * query can fetch only that slice instead of a whole table. null when there are no trades.
 */
export function tradeQueryBounds(
  tradeDates: string[],
  windowDays: number
): { from: string; to: string } | null {
  if (tradeDates.length === 0) return null;
  const sorted = [...tradeDates].sort();
  return { from: shiftDays(sorted[0]!, -windowDays), to: sorted[sorted.length - 1]! };
}

/**
 * Points (sorted ascending by `date`, YYYY-MM-DD) that fall inside at least one
 * `[tradeDate - windowDays, tradeDate]` window. Windows are merged and walked in a single pass
 * over the points, so cost is O(points + windows) rather than O(points × windows).
 */
export function selectPointsInWindows<T extends { date: string }>(
  points: T[],
  tradeDates: string[],
  windowDays: number
): T[] {
  if (tradeDates.length === 0 || points.length === 0) return [];

  const merged: { from: string; to: string }[] = [];
  for (const to of [...new Set(tradeDates)].sort()) {
    const from = shiftDays(to, -windowDays);
    const last = merged[merged.length - 1];
    if (last && from <= last.to) last.to = to;
    else merged.push({ from, to });
  }

  const out: T[] = [];
  let w = 0;
  for (const point of points) {
    while (w < merged.length && point.date > merged[w]!.to) w++;
    if (w === merged.length) break;
    if (point.date >= merged[w]!.from) out.push(point);
  }
  return out;
}
