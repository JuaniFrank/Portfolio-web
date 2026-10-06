import { describe, expect, it } from "vitest";
import { batchStateAfterDelete, countByType } from "./delete-helpers";

describe("batchStateAfterDelete", () => {
  it("reverts a batch with no rows left", () => {
    expect(batchStateAfterDelete(0)).toEqual({ rowsImported: 0, status: "REVERTED" });
  });

  it("keeps a batch with remaining rows committed and recounts it", () => {
    expect(batchStateAfterDelete(7)).toEqual({ rowsImported: 7, status: "COMMITTED" });
  });
});

describe("countByType", () => {
  it("counts rows per transaction type", () => {
    const rows = [{ type: "BUY" }, { type: "BUY" }, { type: "SELL" }, { type: "COUPON" }] as const;
    expect(countByType(rows)).toEqual({ BUY: 2, SELL: 1, COUPON: 1 });
  });

  it("returns an empty object for no rows", () => {
    expect(countByType([])).toEqual({});
  });
});
