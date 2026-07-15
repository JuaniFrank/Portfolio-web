/**
 * Curated ticker → display-name map.
 *
 * data912 provides no names, so this is our own layer. It doesn't need to be
 * exhaustive: unmatched tickers fall back to the ticker itself. Grow it as
 * needed — the sync applies these names on every run, so adding an entry here
 * and re-running the catalog sync backfills it.
 *
 * Focused on the most-traded CEDEARs/ETFs where a name materially improves the
 * autocomplete UX. Argentine stocks and ONs are left ticker-only for now.
 */

export const CURATED_INSTRUMENT_NAMES: Record<string, string> = {
  // Mega-cap tech
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corp.",
  GOOGL: "Alphabet Inc. (Class A)",
  AMZN: "Amazon.com Inc.",
  META: "Meta Platforms Inc.",
  NVDA: "NVIDIA Corp.",
  TSLA: "Tesla Inc.",
  NFLX: "Netflix Inc.",
  AMD: "Advanced Micro Devices",
  INTC: "Intel Corp.",
  // Finance / payments
  V: "Visa Inc.",
  MA: "Mastercard Inc.",
  JPM: "JPMorgan Chase & Co.",
  BAC: "Bank of America Corp.",
  KO: "The Coca-Cola Company",
  PEP: "PepsiCo Inc.",
  DIS: "The Walt Disney Company",
  MCD: "McDonald's Corp.",
  // ETFs (CEDEARs de ETF)
  SPY: "SPDR S&P 500 ETF Trust",
  QQQ: "Invesco QQQ Trust (Nasdaq 100)",
  DIA: "SPDR Dow Jones Industrial Average ETF",
  IWM: "iShares Russell 2000 ETF",
  EEM: "iShares MSCI Emerging Markets ETF",
  ARKK: "ARK Innovation ETF",
  IBIT: "iShares Bitcoin Trust ETF",
  GLD: "SPDR Gold Shares",
  // Argentine ADRs commonly traded as CEDEARs
  GGAL: "Grupo Financiero Galicia",
  YPF: "YPF S.A.",
  PAM: "Pampa Energía S.A.",
  BMA: "Banco Macro S.A.",
  MELI: "MercadoLibre Inc.",
};

/** Returns the curated name for a ticker, or the ticker itself as a fallback. */
export function displayNameFor(ticker: string): string {
  return CURATED_INSTRUMENT_NAMES[ticker.toUpperCase()] ?? ticker.toUpperCase();
}
