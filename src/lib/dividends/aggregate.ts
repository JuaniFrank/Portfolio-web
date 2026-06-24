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
  brokerFxRate: { toString(): string } | null;
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

function tickerForTax(t: RawTransaction): string | null {
  if (t.instrument?.ticker) return t.instrument.ticker.toUpperCase();
  return tickerFromTaxNotes(t.notes);
}

function asDividendCurrency(code: string): DividendCurrency {
  return code === "USD" ? "USD" : "ARS";
}

/**
 * Empareja las retenciones (TAX_WITHHOLDING) con su dividendo del mismo ticker y fecha,
 * sin importar la moneda — Balanz reporta el dividendo de CEDEARs en USD (especie
 * "dólar cable / CV 7000", que indica origen exterior y NO es una tasa de cambio)
 * y el impuesto en ARS, mientras que para acciones AR ambos vienen en ARS.
 *
 * Cada `ReceivedDividend` lleva los valores SOLO en la moneda nativa del depósito.
 * Las conversiones cross-currency se hacen en `build.ts` usando una cotización CCL
 * del momento (no del día del pago), porque mezclar USD+ARS de meses distintos solo
 * tiene sentido como referencia.
 */
export function aggregateReceivedDividends(rows: RawTransaction[]): ReceivedDividend[] {
  const dividends = rows.filter((r) => r.type === TransactionType.DIVIDEND_CASH && r.instrument);
  const taxes = rows.filter((r) => r.type === TransactionType.TAX_WITHHOLDING);

  type TaxBucket = { ars: Decimal; usd: Decimal };
  const taxByKey = new Map<string, TaxBucket>();
  for (const t of taxes) {
    const ticker = tickerForTax(t);
    if (!ticker) continue;
    const dateKey = t.tradeDate.toISOString().slice(0, 10);
    const key = `${ticker}|${dateKey}`;
    const amount = new Decimal(t.netAmount.toString()).abs();
    const bucket = taxByKey.get(key) ?? { ars: new Decimal(0), usd: new Decimal(0) };
    if (asDividendCurrency(t.currencyCode) === "USD") {
      bucket.usd = bucket.usd.plus(amount);
    } else {
      bucket.ars = bucket.ars.plus(amount);
    }
    taxByKey.set(key, bucket);
  }

  return dividends.map((d) => {
    const instrument = d.instrument!;
    const ticker = instrument.ticker.toUpperCase();
    const dateKey = d.tradeDate.toISOString().slice(0, 10);
    const matchKey = `${ticker}|${dateKey}`;
    const taxBucket = taxByKey.get(matchKey) ?? { ars: new Decimal(0), usd: new Decimal(0) };

    const nativeCurrency = asDividendCurrency(d.currencyCode);
    const grossNative = new Decimal(d.netAmount.toString()).abs();

    const grossUsd = nativeCurrency === "USD" ? grossNative : new Decimal(0);
    const grossArs = nativeCurrency === "ARS" ? grossNative : new Decimal(0);

    // Los impuestos se acumulan en su moneda original. Para CEDEARs el impuesto siempre
    // viene en ARS y el dividendo en USD: no calculamos un "neto USD" porque restar
    // ARS de USD no tiene sentido. La UI muestra ambos lados por separado.
    const taxArs = taxBucket.ars;
    const taxUsd = taxBucket.usd;

    // Neto en moneda nativa: solo cuando dividendo y tax comparten moneda.
    const netUsd = nativeCurrency === "USD" ? grossUsd.minus(taxUsd) : new Decimal(0);
    const netArs = nativeCurrency === "ARS" ? grossArs.minus(taxArs) : new Decimal(0);

    return {
      id: d.id,
      tradeDate: d.tradeDate.toISOString(),
      ticker,
      instrumentType: instrument.type,
      instrumentName: instrument.name,
      currencyCode: nativeCurrency,
      grossUsd: grossUsd.toFixed(2),
      grossArs: grossArs.toFixed(2),
      taxUsd: taxUsd.toFixed(2),
      taxArs: taxArs.toFixed(2),
      netUsd: netUsd.toFixed(2),
      netArs: netArs.toFixed(2),
      // El campo brokerFxRate (ej. "7000") es un código de especie, NO una cotización.
      // Lo persistimos por trazabilidad pero no lo exponemos como CCL.
      cclAtPayment: null,
    };
  });
}
