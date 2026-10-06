import { describe, expect, it } from "vitest";
import { computeTradeAmounts } from "./trade-amounts";

describe("computeTradeAmounts", () => {
  it("adds costs on a buy", () => {
    const r = computeTradeAmounts({ side: "BUY", quantity: "10", price: "2.5", fees: "1", taxes: "0.5" });
    expect(r.grossAmount).toBe("25");
    expect(r.netAmount).toBe("26.5");
  });

  it("nets costs out on a sell", () => {
    const r = computeTradeAmounts({ side: "SELL", quantity: "10", price: "2.5", fees: "1", taxes: "0.5" });
    expect(r.grossAmount).toBe("25");
    expect(r.netAmount).toBe("23.5");
  });

  it("treats missing fees and taxes as zero", () => {
    const r = computeTradeAmounts({ side: "BUY", quantity: "3", price: "10" });
    expect(r.fees).toBe("0");
    expect(r.taxes).toBe("0");
    expect(r.netAmount).toBe("30");
  });

  it("keeps decimal precision", () => {
    const r = computeTradeAmounts({ side: "BUY", quantity: "0.1", price: "0.2" });
    expect(r.grossAmount).toBe("0.02");
  });

  it("includes market rights as a cost, preserved on edit", () => {
    const buy = computeTradeAmounts({ side: "BUY", quantity: "1", price: "100", marketRights: "2" });
    expect(buy.netAmount).toBe("102");
    const sell = computeTradeAmounts({ side: "SELL", quantity: "1", price: "100", marketRights: "2" });
    expect(sell.netAmount).toBe("98");
  });
});
