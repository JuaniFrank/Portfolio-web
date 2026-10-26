import { describe, expect, it } from "vitest";
import { CCL_RATE_WHERE } from "./ccl-rate-filter";

describe("CCL_RATE_WHERE", () => {
  it("restricts USD/ARS rates to the CCL source so MEP rows of the same day are never picked", () => {
    expect(CCL_RATE_WHERE).toEqual({
      baseCurrencyCode: "USD",
      quoteCurrencyCode: "ARS",
      source: "CCL",
    });
  });
});
