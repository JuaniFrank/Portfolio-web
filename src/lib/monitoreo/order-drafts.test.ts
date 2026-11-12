import { describe, expect, it } from "vitest";
import { ghostMarkers, newDraft, parseDecimalInput, resolveDrafts, type OrderDraft } from "./order-drafts";

const ctx = { defaultBasisPrice: 100, factor: 1, moneyFactor: 1 as number | null, feePct: 0, referencePrice: null };
const draft = (patch: Partial<OrderDraft>): OrderDraft => ({ ...newDraft("d"), ...patch });
const position = { quantity: 10, avgCost: 100 };

describe("parseDecimalInput", () => {
  it("accepts comma or dot decimals and rejects empty text", () => {
    expect(parseDecimalInput("1,5")).toBe(1.5);
    expect(parseDecimalInput(" 2.25 ")).toBe(2.25);
    expect(parseDecimalInput("")).toBeNaN();
    expect(parseDecimalInput("abc")).toBeNaN();
    expect(parseDecimalInput("1234,5")).toBe(1234.5);
    expect(parseDecimalInput("1234.5")).toBe(1234.5);
  });

  it("reads es-AR thousands with a comma decimal", () => {
    expect(parseDecimalInput("1.234,5")).toBe(1234.5);
    expect(parseDecimalInput("1.234.567,89")).toBe(1234567.89);
  });

  it("rejects hex and exponent forms", () => {
    expect(parseDecimalInput("0x10")).toBeNaN();
    expect(parseDecimalInput("1e3")).toBeNaN();
    expect(parseDecimalInput("Infinity")).toBeNaN();
    expect(parseDecimalInput("1,2,3")).toBeNaN();
  });
});

describe("resolveDrafts", () => {
  it("falls back to the default (market) price while the price is untouched", () => {
    const { rows, result } = resolveDrafts(position, [draft({ quantityText: "10" })], ctx);
    expect(rows[0]).toMatchObject({ basisPrice: 100, chartPrice: 100, quantity: 10 });
    expect(result!.totals.quantity).toBe(20);
  });

  it("converts the typed basis price to chart scale with the factor", () => {
    const { rows } = resolveDrafts(
      null,
      [draft({ quantityText: "2", priceText: "10,5" })],
      { ...ctx, factor: 1000 }
    );
    expect(rows[0]!.chartPrice).toBeCloseTo(10500, 6);
    expect(rows[0]!.order).toMatchObject({ quantity: 2, price: 10500, side: "buy" });
  });

  it("sizes an amount order in whole units and reports the leftover", () => {
    const { rows } = resolveDrafts(
      position,
      [draft({ mode: "amount", amountText: "1050", priceText: "100" })],
      ctx
    );
    expect(rows[0]!.quantity).toBe(10);
    expect(rows[0]!.sizing).toMatchObject({ kind: "amount", leftover: 50 });
  });

  it("sizes the amount in the chart currency whatever the price basis", () => {
    // 0,1 per basis unit at factor 1000 is 100 on the chart: 1.000 buys 10 units
    const { rows } = resolveDrafts(
      null,
      [draft({ mode: "amount", amountText: "1000", priceText: "0,1" })],
      { ...ctx, factor: 1000 }
    );
    expect(rows[0]!.quantity).toBe(10);
  });

  it("sizes money in pesos per unit in a USD view (ADR 30 USD = 7000 ARS per local share)", () => {
    const mf = 7000 / 30;
    const { rows, result } = resolveDrafts(
      null,
      [draft({ mode: "amount", amountText: "70000", priceText: "30" })],
      { ...ctx, moneyFactor: mf }
    );
    expect(rows[0]!.quantity).toBe(10);
    expect(rows[0]!.sizing).toMatchObject({ kind: "amount", leftover: 0 });
    expect(result!.totals.totalInvested).toBeCloseTo(70000, 3);
  });

  it("cannot size an amount without a money factor", () => {
    const { rows } = resolveDrafts(
      null,
      [draft({ mode: "amount", amountText: "70000", priceText: "30" })],
      { ...ctx, moneyFactor: null }
    );
    expect(rows[0]!.order).toBeNull();
    expect(rows[0]!.sizing).toBeNull();
  });

  it("sizes a sell by amount in whole units and books the realized result", () => {
    // 1.000 at 130 net per unit = 7 units (910), 90 left over; position 10 @ 100
    const { rows, result } = resolveDrafts(
      position,
      [draft({ side: "sell", mode: "amount", amountText: "1000", priceText: "130" })],
      ctx
    );
    expect(rows[0]!.quantity).toBe(7);
    expect(rows[0]!.sizing).toMatchObject({ kind: "amount", leftover: 90 });
    expect(result!.totals).toMatchObject({ quantity: 3, totalProceeds: 910, totalRealized: 210 });
  });

  it("an amount that buys no whole unit produces no order", () => {
    const { rows, result } = resolveDrafts(
      position,
      [draft({ mode: "amount", amountText: "50", priceText: "100" })],
      ctx
    );
    expect(rows[0]!.order).toBeNull();
    expect(rows[0]!.sizing).toMatchObject({ kind: "amount", leftover: 50 });
    expect(result).toBeNull();
  });

  it("solves a target PPC against the holding left by the previous orders", () => {
    const { rows, result } = resolveDrafts(
      position,
      [
        draft({ id: "a", quantityText: "10", priceText: "80" }),
        draft({ id: "b", mode: "target", targetText: "80", priceText: "60" }),
      ],
      ctx
    );
    // after a: 20 @ 90; to reach 80 at 60: n = 20 * 10 / 20 = 10
    expect(rows[1]!.quantity).toBe(10);
    expect(rows[1]!.sizing).toMatchObject({ kind: "target", result: { ok: true } });
    expect(result!.totals.avgCost).toBeCloseTo(80, 6);
  });

  it("converts the basis target to chart scale before solving", () => {
    const { rows } = resolveDrafts(
      { quantity: 10, avgCost: 1000 },
      [draft({ mode: "target", targetText: "0,9", priceText: "0,8" })],
      { ...ctx, factor: 1000 }
    );
    // chart: target 900 at price 800 from 10 @ 1000 -> n = 10 * 100 / 100 = 10
    expect(rows[0]!.quantity).toBe(10);
  });

  it("surfaces why a target cannot be solved and skips the order", () => {
    const { rows } = resolveDrafts(
      position,
      [draft({ mode: "target", targetText: "50", priceText: "60" })],
      ctx
    );
    expect(rows[0]!.order).toBeNull();
    expect(rows[0]!.sizing).toMatchObject({ kind: "target", result: { ok: false, reason: "unreachable" } });
  });

  it("does not support a target on a sell", () => {
    const { rows } = resolveDrafts(
      position,
      [draft({ side: "sell", mode: "target", targetText: "90", priceText: "60" })],
      ctx
    );
    expect(rows[0]!.order).toBeNull();
    expect(rows[0]!.sizing).toMatchObject({ kind: "target", result: { ok: false, reason: "invalid" } });
  });

  it("applies the commission to sizing and to the ledger", () => {
    const { rows, result } = resolveDrafts(
      null,
      [draft({ mode: "amount", amountText: "1010", priceText: "100" })],
      { ...ctx, feePct: 1 }
    );
    expect(rows[0]!.quantity).toBe(10);
    expect(result!.totals.totalFees).toBeCloseTo(10, 6);
    expect(result!.totals.avgCost).toBeCloseTo(101, 6);
  });

  it("attaches each ledger step to its row", () => {
    const { rows } = resolveDrafts(
      position,
      [draft({ id: "a", quantityText: "10", priceText: "80" }), draft({ id: "b", side: "sell", quantityText: "5", priceText: "120" })],
      ctx
    );
    expect(rows[0]!.step).toMatchObject({ avgCostAfter: 90, quantityAfter: 20 });
    expect(rows[1]!.step).toMatchObject({ side: "sell", realized: 150 });
  });

  it("returns no result for a non-comparable position", () => {
    const { result, rows } = resolveDrafts({ quantity: 5, avgCost: null }, [draft({ quantityText: "1" })], ctx);
    expect(result).toBeNull();
    expect(rows[0]!.order).not.toBeNull();
  });
});

describe("ghostMarkers", () => {
  const order = (id: string, side: "buy" | "sell", price: number, quantity: number) => ({ id, side, price, quantity });

  it("drops orders that resolve to zero units (a fully clamped sell)", () => {
    expect(ghostMarkers([order("a", "sell", 100, 0), order("b", "buy", 90, 2)]).map((m) => m.id)).toEqual(["b"]);
  });

  it("merges same-side orders at the identical price into one marker", () => {
    const merged = ghostMarkers([order("a", "buy", 100, 2), order("b", "buy", 100, 3), order("c", "sell", 100, 1)]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: "a", side: "buy", quantity: 5 });
    expect(merged[1]).toMatchObject({ id: "c", side: "sell", quantity: 1 });
  });
});
