import Decimal from "decimal.js";
import { TransactionType, type InstrumentType } from "@/lib/generated/prisma";
import type { DividendCurrency, ReceivedDividend } from "./types";

type RawTransaction = {
  id: string;
  type: TransactionType;
  tradeDate: Date;
  quantity: { toString(): string };
  netAmount: { toString(): string };
  currencyCode: string;
  notes: string | null;
  instrument: {
    id: string;
    ticker: string;
    type: InstrumentType;
    name: string;
  } | null;
};

const TICKER_FROM_NOTES = /-\s*([A-Z0-9.]+)\s*$/i;

function tickerFromTaxNotes(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(TICKER_FROM_NOTES);
  return m?.[1]?.trim().toUpperCase() ?? null;
}

function asDividendCurrency(code: string): DividendCurrency {
  return code === "USD" ? "USD" : "ARS";
}

/**
 * Asocia las retenciones (TAX_WITHHOLDING / Movimiento Manual con ticker en notas)
 * a su dividendo del mismo ticker y fecha. Si no encuentra match, igual reporta
 * el monto bruto sin retención.
 */
export function aggregateReceivedDividends(rows: RawTransaction[]): ReceivedDividend[] {
  const dividends = rows.filter((r) => r.type === TransactionType.DIVIDEND_CASH && r.instrument);
  const taxes = rows.filter((r) => r.type === TransactionType.TAX_WITHHOLDING);

  const taxByKey = new Map<string, Decimal>();
  for (const t of taxes) {
    const ticker = tickerFromTaxNotes(t.notes);
    if (!ticker) continue;
    const dateKey = t.tradeDate.toISOString().slice(0, 10);
    const currencyKey = asDividendCurrency(t.currencyCode);
    const key = `${ticker}|${dateKey}|${currencyKey}`;
    const amount = new Decimal(t.netAmount.toString()).abs();
    taxByKey.set(key, (taxByKey.get(key) ?? new Decimal(0)).plus(amount));
  }

  return dividends.map((d) => {
    const instrument = d.instrument!;
    const ticker = instrument.ticker.toUpperCase();
    const dateKey = d.tradeDate.toISOString().slice(0, 10);
    const currencyKey = asDividendCurrency(d.currencyCode);
    const matchKey = `${ticker}|${dateKey}|${currencyKey}`;
    const tax = taxByKey.get(matchKey) ?? new Decimal(0);
    const gross = new Decimal(d.netAmount.toString()).abs();
    const net = gross.minus(tax);

    return {
      id: d.id,
      tradeDate: d.tradeDate.toISOString(),
      ticker,
      instrumentType: instrument.type,
      instrumentName: instrument.name,
      grossAmount: gross.toFixed(2),
      taxAmount: tax.toFixed(2),
      netAmount: net.toFixed(2),
      currencyCode: currencyKey,
    };
  });
}
