import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("mapWithConcurrency", () => {
  it("never exceeds the given concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await mapWithConcurrency(items, 3, async (item) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await delay(5 + (item % 3));
      inFlight--;
      return item;
    });

    expect(peak).toBeLessThanOrEqual(3);
  });

  it("preserves input order in the output regardless of completion order", async () => {
    // Deliberately reverse the completion order: earlier items finish last.
    const items = [30, 10, 20, 5];
    const results = await mapWithConcurrency(items, 4, async (item) => {
      await delay(item);
      return item;
    });

    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([30, 10, 20, 5]);
  });

  it("one item's rejection does not sink the batch — others still resolve", async () => {
    const items = [1, 2, 3];
    const results = await mapWithConcurrency(items, 2, async (item) => {
      if (item === 2) throw new Error("boom");
      return item * 10;
    });

    expect(results[0]).toEqual({ status: "fulfilled", value: 10 });
    expect(results[1]?.status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: 30 });
  });

  it("a budget cutoff stops starting new work without aborting in-flight work", async () => {
    const started: number[] = [];
    let elapsed = 0;
    const items = [0, 1, 2, 3, 4];

    const results = await mapWithConcurrency(
      items,
      1, // sequential, so the budget check between items is deterministic
      async (item) => {
        started.push(item);
        await delay(5);
        elapsed += 5;
        return item;
      },
      { budgetMs: 12, now: () => elapsed }
    );

    // With concurrency 1 and a 5ms step, the budget (12ms) allows starting
    // items while elapsed < 12: item 0 (elapsed 0), item 1 (elapsed 5), item
    // 2 (elapsed 10) all start; item 3 (elapsed 15) must NOT start.
    expect(started).toEqual([0, 1, 2]);
    expect(results[0]).toEqual({ status: "fulfilled", value: 0 });
    expect(results[1]).toEqual({ status: "fulfilled", value: 1 });
    expect(results[2]).toEqual({ status: "fulfilled", value: 2 });
    expect(results[3]).toEqual({ status: "skipped" });
    expect(results[4]).toEqual({ status: "skipped" });
  });
});
