import { describe, expect, it } from "vitest";
import { InstrumentType, TransactionType } from "@/lib/generated/prisma";
import {
  definesInstrumentCurrency,
  denominationsFromRows,
  instrumentCurrencyForRow,
  instrumentScopeKey,
  mergeCatalogDenominations,
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

describe("fixed income keeps one instrument across trade currencies", () => {
  const onScope = { ticker: "MCC3O", instrumentType: InstrumentType.ON, venueCode: "BYMA" };
  const onBuyInUsd = { ...onScope, type: TransactionType.BUY, currencyCode: "USD" };
  const onSellInArs = { ...onScope, type: TransactionType.SELL, currencyCode: "ARS" };

  it("an ON sold in pesos resolves to the dollar instrument it was bought in", () => {
    expect(instrumentCurrencyForRow(onSellInArs, "USD")).toBe("USD");
  });

  it("applies to every fixed-income type", () => {
    for (const instrumentType of [InstrumentType.BOND_AR, InstrumentType.LETRA]) {
      expect(instrumentCurrencyForRow({ ...onSellInArs, instrumentType }, "USD")).toBe("USD");
    }
  });

  it("an ON trade with no known denomination keeps its own currency", () => {
    expect(instrumentCurrencyForRow(onSellInArs, undefined)).toBe("ARS");
  });

  it("a batch with a USD buy and an ARS sell of the same ON states one denomination", () => {
    const denominations = denominationsFromRows([onBuyInUsd, onSellInArs]);
    const scopeCurrency = denominations.get(instrumentScopeKey(onScope));

    expect(instrumentCurrencyForRow(onBuyInUsd, scopeCurrency)).toBe("USD");
    expect(instrumentCurrencyForRow(onSellInArs, scopeCurrency)).toBe("USD");
  });
});

describe("mergeCatalogDenominations", () => {
  const onScope = { ticker: "MCC3O", instrumentType: InstrumentType.ON, venueCode: "BYMA" };

  it("the existing ON outvotes the currency of a later sell in the batch", () => {
    const batch = new Map([[instrumentScopeKey(onScope), "ARS"]]);

    const merged = mergeCatalogDenominations(batch, [{ ...onScope, currencyCode: "USD" }]);

    expect(merged.get(instrumentScopeKey(onScope))).toBe("USD");
  });

  it("for equities the trades in the batch still win over the catalog", () => {
    const batch = new Map([[instrumentScopeKey(cedearScope), "ARS"]]);

    const merged = mergeCatalogDenominations(batch, [{ ...cedearScope, currencyCode: "USD" }]);

    expect(merged.get(instrumentScopeKey(cedearScope))).toBe("ARS");
  });

  it("fills a scope the batch says nothing about", () => {
    const merged = mergeCatalogDenominations(new Map(), [{ ...cedearScope, currencyCode: "ARS" }]);

    expect(merged.get(instrumentScopeKey(cedearScope))).toBe("ARS");
  });

  it("trusts no catalog currency when the scope already holds two", () => {
    const batch = new Map([[instrumentScopeKey(onScope), "ARS"]]);

    const merged = mergeCatalogDenominations(batch, [
      { ...onScope, currencyCode: "USD" },
      { ...onScope, currencyCode: "ARS" },
    ]);

    expect(merged.get(instrumentScopeKey(onScope))).toBe("ARS");
  });

  it("does not mutate the batch map", () => {
    const batch = new Map<string, string>();

    mergeCatalogDenominations(batch, [{ ...onScope, currencyCode: "USD" }]);

    expect(batch.size).toBe(0);
  });
});
