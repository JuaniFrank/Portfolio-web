import { describe, expect, it } from "vitest";
import al30 from "./__fixtures__/docta/instruments-AL30.json";
import al30d from "./__fixtures__/docta/instruments-AL30D.json";
import mcc3o from "./__fixtures__/docta/instruments-MCC3O.json";
import { groupByIsin, type IsinRow } from "./isin-grouping";

function rowFromFixture(fixture: { data: Array<{ ticker: string; isin: string }> }): IsinRow {
  const row = fixture.data[0]!;
  return { ticker: row.ticker, isin: row.isin };
}

describe("groupByIsin", () => {
  it("groups AL30 and AL30D into one group of two, sharing ISIN ARARGE3209S6", () => {
    const groups = groupByIsin([rowFromFixture(al30), rowFromFixture(al30d)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.isin).toBe("ARARGE3209S6");
    expect(groups[0]!.tickers.sort()).toEqual(["AL30", "AL30D"]);
  });

  it("MCC3O forms its own separate group of one", () => {
    const groups = groupByIsin([rowFromFixture(al30), rowFromFixture(al30d), rowFromFixture(mcc3o)]);
    expect(groups).toHaveLength(2);
    const mcc3oGroup = groups.find((g) => g.tickers.includes("MCC3O"));
    expect(mcc3oGroup).toMatchObject({ isin: "AR0922852063", tickers: ["MCC3O"] });
  });

  it("two rows with isin: null do NOT group together — the most likely wrong implementation", () => {
    const groups = groupByIsin([
      { ticker: "FOO", isin: null },
      { ticker: "BAR", isin: null },
    ]);
    expect(groups).toHaveLength(0);
  });

  it("a blank or whitespace-only ISIN is treated as null (not grouped)", () => {
    const groups = groupByIsin([
      { ticker: "FOO", isin: "" },
      { ticker: "BAR", isin: "   " },
    ]);
    expect(groups).toHaveLength(0);
  });
});
