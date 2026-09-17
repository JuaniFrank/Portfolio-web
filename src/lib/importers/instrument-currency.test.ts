import { describe, expect, it } from "vitest";
import { InstrumentType, TransactionType } from "@/lib/generated/prisma";
import {
  definesInstrumentCurrency,
  denominationsFromRows,
  instrumentCurrencyForRow,
  instrumentScopeKey,
} from "./instrument-currency";

const cedearScope = { ticker: "AAPL", instrumentType: InstrumentType.CEDEAR, venueCode: "BYMA" };

const buyInArs = {
  ...cedearScope,
  type: TransactionType.BUY,
  currencyCode: "ARS",
};

const dividendPaidInUsd = {
  ...cedearScope,
  type: TransactionType.DIVIDEND_CASH,
  currencyCode: "USD",
};

describe("definesInstrumentCurrency", () => {
  it("only a trade states what currency an instrument is denominated in", () => {
    expect(definesInstrumentCurrency(TransactionType.BUY)).toBe(true);
    expect(definesInstrumentCurrency(TransactionType.SELL)).toBe(true);
  });

  it("cash events carry the currency they were paid in, not the instrument's", () => {
    expect(definesInstrumentCurrency(TransactionType.DIVIDEND_CASH)).toBe(false);
    expect(definesInstrumentCurrency(TransactionType.COUPON)).toBe(false);
    expect(definesInstrumentCurrency(TransactionType.AMORTIZATION)).toBe(false);
    expect(definesInstrumentCurrency(TransactionType.INTEREST)).toBe(false);
    expect(definesInstrumentCurrency(TransactionType.TAX_WITHHOLDING)).toBe(false);
    expect(definesInstrumentCurrency(TransactionType.DIVIDEND_STOCK)).toBe(false);
  });
});

describe("denominationsFromRows", () => {
  it("takes the denomination from trades and ignores cash events", () => {
    const denominations = denominationsFromRows([dividendPaidInUsd, buyInArs]);

    expect(denominations.get(instrumentScopeKey(cedearScope))).toBe("ARS");
  });

  it("states nothing for an instrument that was never traded in the batch", () => {
    const denominations = denominationsFromRows([dividendPaidInUsd]);

    expect(denominations.get(instrumentScopeKey(cedearScope))).toBeUndefined();
  });

  it("keeps instruments of the same ticker but different type apart", () => {
    const denominations = denominationsFromRows([
      buyInArs,
      { ...buyInArs, instrumentType: InstrumentType.STOCK_US, currencyCode: "USD" },
    ]);

    expect(denominations.get(instrumentScopeKey(cedearScope))).toBe("ARS");
    expect(
      denominations.get(instrumentScopeKey({ ...cedearScope, instrumentType: InstrumentType.STOCK_US }))
    ).toBe("USD");
  });
});

describe("instrumentCurrencyForRow", () => {
  it("a USD dividend resolves to the peso instrument the trades established", () => {
    expect(instrumentCurrencyForRow(dividendPaidInUsd, "ARS")).toBe("ARS");
  });

  it("a trade always keeps its own currency, even against a different denomination", () => {
    expect(instrumentCurrencyForRow(buyInArs, "USD")).toBe("ARS");
  });

  it("falls back to the row's own currency when nothing states the denomination", () => {
    expect(instrumentCurrencyForRow(dividendPaidInUsd, undefined)).toBe("USD");
  });
});
