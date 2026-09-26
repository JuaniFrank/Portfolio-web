import type { AllocationSlice } from "./types";

export const REST_SLICE_KEY = "__rest__";

/**
 * Keeps the first `topN` slices and folds the tail into a single "Otros" slice.
 *
 * Slices that already carry `details` (e.g. grouped ONs) are never folded: they are a
 * group themselves. The "Otros" slice lists what it absorbed as `details`, so the
 * tooltip can show which tickers fall into it.
 */
export function groupAllocationSlices(data: AllocationSlice[], topN?: number): AllocationSlice[] {
  if (!topN || data.length <= topN) return data;

  const protectedSlices = data.filter((d) => d.details?.length);
  const regular = data.filter((d) => !d.details?.length);
  const regularBudget = Math.max(topN - protectedSlices.length, 0);
  const top = regular.slice(0, regularBudget);
  const restItems = regular.slice(regularBudget);

  if (restItems.length === 0) return [...protectedSlices, ...top];

  let restValueArs = 0;
  let restValueUsd = 0;
  let restPercent = 0;
  for (const r of restItems) {
    restValueArs += Number(r.valueArs);
    restValueUsd += Number(r.valueUsd);
    restPercent += Number(r.percent);
  }

  return [
    ...protectedSlices,
    ...top,
    {
      key: REST_SLICE_KEY,
      label: "Otros",
      valueArs: restValueArs.toFixed(2),
      valueUsd: restValueUsd.toFixed(2),
      percent: restPercent.toFixed(2),
      details: restItems.map(({ key, label, valueArs, valueUsd, percent }) => ({
        key,
        label,
        valueArs,
        valueUsd,
        percent,
      })),
    },
  ];
}
