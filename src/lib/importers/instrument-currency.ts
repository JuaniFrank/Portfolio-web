import { TransactionType, type InstrumentType } from "@/lib/generated/prisma";

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
 * The currency to identify this row's instrument with. `scopeCurrency` is the
 * denomination known from elsewhere (a trade in the same batch, or the existing
 * catalog row). Falling back to the row's own currency keeps a cash movement for
 * an instrument nobody ever traded linked to something rather than dropping it.
 */
export function instrumentCurrencyForRow(
  row: Pick<DenominationRow, "type" | "currencyCode">,
  scopeCurrency: string | undefined
): string {
  if (definesInstrumentCurrency(row.type)) return row.currencyCode;
  return scopeCurrency ?? row.currencyCode;
}
