/**
 * Argentine stocks that also trade in the US as ADRs: BYMA local ticker -> Yahoo ADR symbol.
 * Symbols only; the ADR/local ratio is deliberately not modeled (trades are projected with the
 * same-day price factor instead).
 */
export const ADR_SYMBOL_BY_LOCAL_TICKER: Readonly<Record<string, string>> = {
  GGAL: "GGAL",
  YPFD: "YPF",
  PAMP: "PAM",
  BMA: "BMA",
  BBAR: "BBAR",
  SUPV: "SUPV",
  CEPU: "CEPU",
  TGSU2: "TGS",
  LOMA: "LOMA",
  TECO2: "TEO",
  EDN: "EDN",
  CRES: "CRESY",
  IRSA: "IRS",
  VIST: "VIST",
};

export function adrSymbolFor(localTicker: string | null | undefined): string | null {
  const key = localTicker?.trim().toUpperCase();
  if (!key) return null;
  return Object.hasOwn(ADR_SYMBOL_BY_LOCAL_TICKER, key)
    ? (ADR_SYMBOL_BY_LOCAL_TICKER[key] ?? null)
    : null;
}
