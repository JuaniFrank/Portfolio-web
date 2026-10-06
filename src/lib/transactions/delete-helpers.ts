/**
 * State an ImportBatch must have after some of its transactions were deleted:
 * the count is re-derived from what is left, and an empty batch is REVERTED.
 */
export function batchStateAfterDelete(remaining: number): {
  rowsImported: number;
  status: "COMMITTED" | "REVERTED";
} {
  return { rowsImported: remaining, status: remaining === 0 ? "REVERTED" : "COMMITTED" };
}

/** Rows per transaction type, for the delete-holding confirmation preview. */
export function countByType<T extends string>(rows: readonly { type: T }[]): Partial<Record<T, number>> {
  const counts: Partial<Record<T, number>> = {};
  for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;
  return counts;
}
