import { describe, expect, it } from "vitest";
import al30Instrument from "./__fixtures__/docta/instruments-AL30.json";
import mcc3oInstrument from "./__fixtures__/docta/instruments-MCC3O.json";
import al30Cashflow from "./__fixtures__/docta/cashflow-AL30.json";
import mcc3oCashflow from "./__fixtures__/docta/cashflow-MCC3O.json";
import {
  mapDoctaInstrument,
  mapDoctaCashflow,
  mapDoctaSchedule,
  type DoctaCashflowResponse,
} from "./docta-mapping";

// NOTE (2026-09-16, ON-through-Docta scope confirmation): `MCC3O` (used
// throughout this file) is an ON (`instruments-MCC3O.json`'s own
// `sub_asset_class: "ON"`), not a BOND_AR/LETRA. `mapDoctaInstrument`,
// `mapDoctaCashflow`, and `mapDoctaSchedule` all take no `InstrumentType`
// parameter — they are structurally agnostic to which fixed-income type
// called them — so every test below already exercises the exact code path
// an ON instrument uses in production, including the step-up-refusal gate
// (locked separately below against `AL30`, a BOND_AR). No ON-specific branch
// exists to test differently.
describe("mapDoctaInstrument", () => {
  it("repairs the mojibake name and maps isin/sector/issuer/law/assetClass unchanged", () => {
    const mapped = mapDoctaInstrument(mcc3oInstrument);
    expect(mapped.name).toBe("Pecom Servicios EnergíA S.A.U. 2030 U$S 7.50% (MCC3O)");
    expect(mapped.issuer).toBe("Pecom Servicios EnergíA S.A.U.");
    expect(mapped.isin).toBe("AR0922852063");
    expect(mapped.sector).toBe("Oil & Gas");
    expect(mapped.law).toBe("Ley Argentina");
    expect(mapped.assetClass).toBe("BOND");
  });

  it("leaves an already-clean name untouched", () => {
    const mapped = mapDoctaInstrument(al30Instrument);
    expect(mapped.name).toBe("Soberano HD 2030 U$S 1.75% (AL30)");
    expect(mapped.isin).toBe("ARARGE3209S6");
  });
});

describe("mapDoctaCashflow — MCC3O (constant rate, auto-fill path)", () => {
  it("maps couponRate, couponFrequencyMonths, issueDate/maturityDate, and a 100%-summing amortization schedule", () => {
    const result = mapDoctaCashflow(mcc3oCashflow, mcc3oInstrument.data[0]!.name);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.terms.couponRate).toBe("0.075");
    expect(result.terms.couponFrequencyMonths).toBe(6);
    expect(result.terms.issueDate).toBe("2026-05-11");
    expect(result.terms.maturityDate).toBe("2030-05-13");
    const sum = result.terms.amortizationSchedule.reduce((acc, row) => acc + row.principalPct, 0);
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.01);
    expect(result.terms.currencyCode).toBe("USD");
    expect(result.terms.faceValue).toBe("100");
    expect(result.terms.rateType).toBe("FIXED");
  });

  it("never writes a dayCountConvention — the schema default ACT/365 applies untouched", () => {
    const result = mapDoctaCashflow(mcc3oCashflow, mcc3oInstrument.data[0]!.name);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("dayCountConvention" in result.terms).toBe(false);
  });
});

describe("mapDoctaCashflow — §8.3b gate cases (propose, never guess)", () => {
  it("amortization summing to 99 (not 100) blocks auto-fill", () => {
    const mutated: DoctaCashflowResponse = structuredClone(mcc3oCashflow);
    mutated.data[mutated.data.length - 1]!.capital = 99;
    const result = mapDoctaCashflow(mutated, mcc3oInstrument.data[0]!.name);
    expect(result.ok).toBe(false);
  });

  it("a name with no recognized currency token blocks auto-fill", () => {
    const result = mapDoctaCashflow(mcc3oCashflow, "Bono Corporativo ABC 2030 7.50%");
    expect(result.ok).toBe(false);
  });

  it("a name containing only a bare $ never matches — blocks auto-fill, never defaults a currency", () => {
    const result = mapDoctaCashflow(mcc3oCashflow, "Bono Corporativo ABC 2030 $ 7.50%");
    expect(result.ok).toBe(false);
  });

  it('a name with "U$S" resolves USD', () => {
    const result = mapDoctaCashflow(mcc3oCashflow, "Bono Corporativo ABC 2030 U$S 7.50%");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.terms.currencyCode).toBe("USD");
  });

  it("a BADLAR marker with a constant rate resolves rateType FLOATING", () => {
    const result = mapDoctaCashflow(mcc3oCashflow, "Bono BADLAR + 200pb U$S 2030");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.terms.rateType).toBe("FLOATING");
  });

  it("LOCKED: AL30's step-up interest_rate (0.13 -> 0.5 -> 0.75 -> 1.75) MUST refuse BondTerms auto-fill", () => {
    const result = mapDoctaCashflow(al30Cashflow, al30Instrument.data[0]!.name);
    expect(result.ok).toBe(false);
  });
});

describe("mapDoctaSchedule (AD-14) — stored verbatim, no derivation", () => {
  it("LOCKED: AL30 yields 19 rows whose interestRate sequence preserves all four distinct steps", () => {
    const rows = mapDoctaSchedule(al30Cashflow);
    expect(rows).toHaveLength(19);
    const distinctRates = new Set(rows.map((r) => r.interestRate));
    expect(distinctRates).toEqual(new Set([0.13, 0.5, 0.75, 1.7500000000000002]));
  });

  it("copies interestAmount verbatim — never recomputed", () => {
    const rows = mapDoctaSchedule(al30Cashflow);
    expect(rows[0]!.interestAmount).toBe(0.1096986301369863);
    expect(rows[rows.length - 1]!.interestAmount).toBe(0.8678082191780823);
  });

  it("residualValue ends at 0", () => {
    const rows = mapDoctaSchedule(al30Cashflow);
    expect(rows[rows.length - 1]!.residualValue).toBe(0);
  });
});
