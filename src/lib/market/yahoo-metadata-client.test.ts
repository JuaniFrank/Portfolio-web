import { describe, expect, it } from "vitest";
import { parseCurrencyVerdict } from "./yahoo-metadata-client";

describe("parseCurrencyVerdict", () => {
  it("maps HTTP 404 to not-listed", () => {
    expect(parseCurrencyVerdict(404, null)).toEqual({ kind: "not-listed" });
  });

  it("maps a transport 5xx to unavailable", () => {
    expect(parseCurrencyVerdict(500, null)).toEqual({ kind: "unavailable" });
    expect(parseCurrencyVerdict(503, null)).toEqual({ kind: "unavailable" });
  });

  it("maps a batch-level ok:false item to unavailable", () => {
    expect(
      parseCurrencyVerdict(200, { symbol: "AL30", ok: false, error: "timeout" })
    ).toEqual({ kind: "unavailable" });
  });

  it("maps listed:false (Yahoo's own 404) to not-listed, evidence of absence", () => {
    expect(
      parseCurrencyVerdict(200, { symbol: "AL30", ok: true, listed: false, currency: null })
    ).toEqual({ kind: "not-listed" });
  });

  it("passes through a confirmed ARS or USD currency", () => {
    expect(
      parseCurrencyVerdict(200, { symbol: "NVDA", ok: true, listed: true, currency: "ARS" })
    ).toEqual({ kind: "currency", currency: "ARS" });
    expect(
      parseCurrencyVerdict(200, { symbol: "NVDAD", ok: true, listed: true, currency: "USD" })
    ).toEqual({ kind: "currency", currency: "USD" });
  });

  it("never passes through a currency other than ARS/USD — unavailable, not a guess", () => {
    expect(
      parseCurrencyVerdict(200, { symbol: "WEIRD", ok: true, listed: true, currency: "BRL" })
    ).toEqual({ kind: "unavailable" });
  });

  it("maps a missing or malformed body to unavailable", () => {
    expect(parseCurrencyVerdict(200, null)).toEqual({ kind: "unavailable" });
    expect(parseCurrencyVerdict(200, undefined)).toEqual({ kind: "unavailable" });
    expect(parseCurrencyVerdict(200, {})).toEqual({ kind: "unavailable" });
  });
});
