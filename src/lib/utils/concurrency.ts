/**
 * Bounded-concurrency map with an optional elapsed-time budget (design §9).
 * Pure with respect to control flow — no Prisma, no fetch; `fn` is injected.
 */

export type ConcurrencyResult<R> =
  | { status: "fulfilled"; value: R }
  | { status: "rejected"; reason: unknown }
  /** Never started: the elapsed-time budget was exhausted before its turn. */
  | { status: "skipped" };

export type MapWithConcurrencyOptions = {
  /** Elapsed-time budget for *starting* new work. In-flight work always
   * finishes; only new starts are stopped once exceeded. */
  budgetMs?: number;
  /** Injectable clock for deterministic tests. Defaults to `Date.now`. */
  now?: () => number;
};

/**
 * Runs `fn` over `items` with at most `limit` concurrent invocations.
 * Output order always matches input order, regardless of completion order.
 * One item's rejection never sinks the batch — every item settles
 * independently. When `budgetMs` is set, items whose turn arrives after the
 * budget elapses are never started (`{ status: "skipped" }`), while any
 * already-started invocation is never aborted.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  options: MapWithConcurrencyOptions = {}
): Promise<ConcurrencyResult<R>[]> {
  const { budgetMs, now = () => Date.now() } = options;
  const results: ConcurrencyResult<R>[] = new Array(items.length);
  const startedAt = now();
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;

      if (budgetMs !== undefined && now() - startedAt >= budgetMs) {
        results[index] = { status: "skipped" };
        continue;
      }

      try {
        const value = await fn(items[index] as T, index);
        results[index] = { status: "fulfilled", value };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
