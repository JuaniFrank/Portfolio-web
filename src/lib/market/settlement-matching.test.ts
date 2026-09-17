import { describe, expect, it } from "vitest";
import { planSettlementLinks, type SettlementQuote } from "./settlement-matching";

/** Anchors implied by the §4.4 measurement itself: CCL ≈ 1582 (mean of the
 * C-suffix ratios), MEP ≈ 1526 (mean of the D-suffix ratios). */
const RATES = { ccl: 1582, mep: 1526, asOf: new Date("2026-09-15T00:00:00Z") };
const NOW = new Date("2026-09-15T12:00:00Z");

function q(ticker: string, type: SettlementQuote["type"], price: number | null, currency: SettlementQuote["currency"]): SettlementQuote {
  return { ticker, type, price, currency };
}

function linkFor(plan: ReturnType<typeof planSettlementLinks>, ticker: string) {
  return plan.links.find((l) => l.variantTicker === ticker);
}

describe("planSettlementLinks — the §4.4 measured table", () => {
  it("NVDA/NVDAC -> CCL, NVDA/NVDAD -> MEP", () => {
    const plan = planSettlementLinks(
      [
        q("NVDA", "CEDEAR", 14120, "ARS"),
        q("NVDAC", "CEDEAR", 8.87, "USD"),
        q("NVDAD", "CEDEAR", 9.22, "USD"),
      ],
      RATES,
      NOW
    );
    expect(linkFor(plan, "NVDAC")).toMatchObject({ baseTicker: "NVDA", settlement: "CCL" });
    expect(linkFor(plan, "NVDAD")).toMatchObject({ baseTicker: "NVDA", settlement: "MEP" });
  });

  it("C/CC -> CCL — CC links to Citigroup, not treated as Chemours", () => {
    const plan = planSettlementLinks(
      [q("C", "CEDEAR", 72300, "ARS"), q("CC", "CEDEAR", 45.84, "USD")],
      RATES,
      NOW
    );
    expect(linkFor(plan, "CC")).toMatchObject({ baseTicker: "C", settlement: "CCL" });
  });

  it("BA/BAC -> CCL, BA/BAD -> MEP", () => {
    const plan = planSettlementLinks(
      [
        q("BA", "CEDEAR", 13830, "ARS"),
        q("BAC", "CEDEAR", 8.76, "USD"),
        q("BAD", "CEDEAR", 9.16, "USD"),
      ],
      RATES,
      NOW
    );
    expect(linkFor(plan, "BAC")).toMatchObject({ baseTicker: "BA", settlement: "CCL" });
    expect(linkFor(plan, "BAD")).toMatchObject({ baseTicker: "BA", settlement: "MEP" });
  });

  it("GGAL/GGALD -> MEP, YPFD/YPFDD -> MEP", () => {
    const plan = planSettlementLinks(
      [
        q("GGAL", "CEDEAR", 6725, "ARS"),
        q("GGALD", "CEDEAR", 4.4, "USD"),
        q("YPFD", "CEDEAR", 9180, "ARS"),
        q("YPFDD", "CEDEAR", 5.97, "USD"),
      ],
      RATES,
      NOW
    );
    expect(linkFor(plan, "GGALD")).toMatchObject({ baseTicker: "GGAL", settlement: "MEP" });
    expect(linkFor(plan, "YPFDD")).toMatchObject({ baseTicker: "YPFD", settlement: "MEP" });
  });

  it("TGNO4/TGN4D -> MEP, confirmed across a ticker rewrite (3-char affinity, no suffix rule)", () => {
    const plan = planSettlementLinks(
      [q("TGNO4", "CEDEAR", 3295, "ARS"), q("TGN4D", "CEDEAR", 2.14, "USD")],
      RATES,
      NOW
    );
    expect(linkFor(plan, "TGN4D")).toMatchObject({ baseTicker: "TGNO4", settlement: "MEP" });
  });

  it("DD/DDD MUST produce a link and MUST NOT produce ARS — the corrected false-negative regression", () => {
    const plan = planSettlementLinks(
      [q("DD", "CEDEAR", 40900, "ARS"), q("DDD", "CEDEAR", 26.32, "USD")],
      RATES,
      NOW
    );
    const link = linkFor(plan, "DDD");
    expect(link?.baseTicker).toBe("DD");
    expect(["MEP", "USD"]).toContain(link?.settlement);
    expect(link?.settlement).not.toBe("ARS" as unknown);
  });

  it("CARC MUST NOT be linked to anything — excluded by the currency partition, not a price band", () => {
    // CARC itself reports ARS (§R.2) — a ticker-suffix rule would have tried
    // to treat it as "CAR" + "C" (a settlement-variant suffix). It must never
    // become a *variant* of anything, decided purely because its own
    // currency is ARS (a base candidate), never because of a price band.
    const plan = planSettlementLinks(
      [q("CAR", "CEDEAR", 1000, "ARS"), q("CARC", "CEDEAR", 22.95, "ARS")],
      RATES,
      NOW
    );
    expect(plan.links.some((l) => l.variantTicker === "CARC")).toBe(false);
  });
});

describe("planSettlementLinks — currency is never lost", () => {
  it("null CCL only, null MEP only, and a stale asOf (4 days) all still emit settlement: USD for a confirmed-USD symbol with no plausible candidate", () => {
    const quotes: SettlementQuote[] = [q("ZZZD", "CEDEAR", 5, "USD")];

    const nullCcl = planSettlementLinks(quotes, { ccl: null, mep: 1526, asOf: RATES.asOf }, NOW);
    const nullMep = planSettlementLinks(quotes, { ccl: 1582, mep: null, asOf: RATES.asOf }, NOW);
    const stale = planSettlementLinks(quotes, { ...RATES, asOf: new Date("2026-09-11T00:00:00Z") }, NOW);

    for (const plan of [nullCcl, nullMep, stale]) {
      expect(linkFor(plan, "ZZZD")).toMatchObject({ settlement: "USD", baseTicker: null });
    }
  });

  it("both anchors null skips with skippedReason: no-rates, still emitting settlement: USD", () => {
    const plan = planSettlementLinks(
      [q("NVDAD", "CEDEAR", 9.22, "USD")],
      { ccl: null, mep: null, asOf: RATES.asOf },
      NOW
    );
    expect(plan.skippedReason).toBe("no-rates");
    expect(linkFor(plan, "NVDAD")).toMatchObject({ settlement: "USD", baseTicker: null });
  });

  it("price 0/null/NaN keeps the currency — unlinked: no-quote, not a currency loss", () => {
    for (const badPrice of [0, null, NaN]) {
      const plan = planSettlementLinks(
        [q("NVDA", "CEDEAR", 14120, "ARS"), q("NVDAD", "CEDEAR", badPrice, "USD")],
        RATES,
        NOW
      );
      expect(linkFor(plan, "NVDAD")).toMatchObject({ settlement: "USD", baseTicker: null });
      expect(plan.unlinked).toContainEqual({ ticker: "NVDAD", reason: "no-quote" });
    }
  });

  it("two ARS bases both passing tolerance for one USD variant -> USD/baseTicker:null, unlinked: ambiguous, currency kept", () => {
    // Two fictional same-type bases whose ratio to the variant both land
    // inside TOLERANCE — an algorithmic edge case, not a real-ticker claim.
    const plan = planSettlementLinks(
      [
        q("ZBASEA", "CEDEAR", 1582, "ARS"),
        q("ZBASEB", "CEDEAR", 1583, "ARS"),
        q("ZBASED", "CEDEAR", 1, "USD"),
      ],
      RATES,
      NOW
    );
    expect(linkFor(plan, "ZBASED")).toMatchObject({ settlement: "USD", baseTicker: null });
    expect(plan.unlinked).toContainEqual({ ticker: "ZBASED", reason: "ambiguous" });
  });

  it("a base and a candidate variant of different InstrumentType never pair", () => {
    const plan = planSettlementLinks(
      [q("XYZ", "STOCK_AR", 1582, "ARS"), q("XYZD", "CEDEAR", 1, "USD")],
      RATES,
      NOW
    );
    expect(linkFor(plan, "XYZD")).toMatchObject({ settlement: "USD", baseTicker: null });
    expect(plan.unlinked).toContainEqual({ ticker: "XYZD", reason: "no-candidate" });
  });

  it("a currency: null (Yahoo 404) quote is not linked by this module at all — never defaults to ARS", () => {
    // AD-13 owns fixed-income membership via ISIN; a symbol Yahoo neither
    // confirms ARS nor USD for is invisible to this module (design §4.3
    // step 0: "emits nothing"). It must never appear in links or unlinked,
    // and specifically must never be assigned ARS by this module.
    const plan = planSettlementLinks(
      [q("AL30", "BOND_AR", 50000, null), q("SOMEBASE", "BOND_AR", 78000000, "ARS")],
      RATES,
      NOW
    );
    expect(plan.links.some((l) => l.variantTicker === "AL30")).toBe(false);
    expect(plan.unlinked.some((u) => u.ticker === "AL30")).toBe(false);
  });
});
