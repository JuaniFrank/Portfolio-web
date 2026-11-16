import { TransactionType, type InstrumentType } from "@/lib/generated/prisma";
import { FIXED_INCOME_TYPES } from "@/lib/transactions/types";

/**
 * Which currency identifies an instrument, as opposed to which currency a given
 * movement happened to move.
 *
 * `instrumentKey` (AD-2) includes `currencyCode`, mirroring the schema's unique
 * constraint. Feeding it the currency of a cash movement mints a phantom row:
 * a CEDEAR trades in pesos but Balanz pays its dividends in dollars, so every
 * USD dividend used to create a second, ownerless "AAPL in USD" instrument
 * holding nothing but that payment.
 */

export type DenominationRow = {
  ticker: string;
  instrumentType: InstrumentType;
  venueCode: string | null;
  currencyCode: string;
  type: TransactionType;
};

/**
 * Only a trade states the denomination. A dividend, coupon, amortization or
 * withholding is an event *on* a position: its currency is how it was paid,
 * which for a CEDEAR is routinely not the currency the CEDEAR trades in.
 */
export function definesInstrumentCurrency(type: TransactionType): boolean {
  return type === TransactionType.BUY || type === TransactionType.SELL;
}

/** Identity minus the currency — the instrument a movement refers to. */
export function instrumentScopeKey(i: {
  ticker: string;
  instrumentType: InstrumentType;
  venueCode: string | null;
}): string {
  return `${i.ticker}|${i.instrumentType}|${i.venueCode ?? ""}`;
}

/** Denomination of each instrument, as stated by the trades in this batch. */
export function denominationsFromRows(rows: DenominationRow[]): Map<string, string> {
  const denominations = new Map<string, string>();
  for (const row of rows) {
    if (!definesInstrumentCurrency(row.type)) continue;
    const key = instrumentScopeKey(row);
    if (!denominations.has(key)) denominations.set(key, row.currencyCode);
  }
  return denominations;
}

/**
 * Whether a trade's currency is just how it was paid rather than a distinct
 * instrument. Balanz exports the same ON ticker (e.g. `MCC3O`) for a purchase
 * paid in dollars and a sale settled in pesos; letting each trade pick the
 * instrument split one position in two, and the sale never closed the purchase.
 * The transaction keeps its own `currencyCode`, which is what valuation reads.
 */
function keepsOneInstrumentAcrossCurrencies(instrumentType: InstrumentType | null | undefined): boolean {
  return instrumentType != null && FIXED_INCOME_TYPES.includes(instrumentType);
}

/**
 * The currency to identify this row's instrument with. `scopeCurrency` is the
 * denomination known from elsewhere (a trade in the same batch, or the existing
 * catalog row). Falling back to the row's own currency keeps a cash movement for
 * an instrument nobody ever traded linked to something rather than dropping it.
 */
export function instrumentCurrencyForRow(
  row: Pick<DenominationRow, "type" | "currencyCode"> & {
    instrumentType?: InstrumentType | null;
  },
  scopeCurrency: string | undefined
): string {
  if (definesInstrumentCurrency(row.type) && !keepsOneInstrumentAcrossCurrencies(row.instrumentType)) {
    return row.currencyCode;
  }
  return scopeCurrency ?? row.currencyCode;
}

export type CatalogInstrument = {
  ticker: string;
  instrumentType: InstrumentType;
  venueCode: string | null;
  currencyCode: string;
};

/**
 * Adds the denominations stated by the existing catalog to the ones stated by the
 * batch. A catalog row is only trusted when its scope holds exactly one currency —
 * otherwise a phantom row from a past import could outvote real trades. For
 * equities the batch's trades win; for fixed income the existing instrument wins,
 * so a later sale in another currency lands on the instrument it is closing.
 */
export function mergeCatalogDenominations(
  batch: Map<string, string>,
  catalog: CatalogInstrument[]
): Map<string, string> {
  const byScope = new Map<string, { instrumentType: InstrumentType; currencies: Set<string> }>();
  for (const inst of catalog) {
    const scope = instrumentScopeKey(inst);
    const entry = byScope.get(scope) ?? { instrumentType: inst.instrumentType, currencies: new Set() };
    entry.currencies.add(inst.currencyCode);
    byScope.set(scope, entry);
  }

  const merged = new Map(batch);
  for (const [scope, { instrumentType, currencies }] of byScope) {
    if (currencies.size !== 1) continue;
    if (merged.has(scope) && !keepsOneInstrumentAcrossCurrencies(instrumentType)) continue;
    merged.set(scope, [...currencies][0]!);
  }
  return merged;
}
