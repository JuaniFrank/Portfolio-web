/**
 * Reglas de "auto-clear": qué filas de un import conviene omitir por defecto
 * porque no aportan a las métricas de la app (depósitos/retiros, ajustes,
 * instrumentos sin histórico de precios, tickers ya amortizados).
 *
 * Puro — no toca la DB. El único insumo externo es `amortizedTickers`, que el
 * caller resuelve contra la base antes de invocar `computeAutoClearMatches`
 * (un ticker cuenta como amortizado si el usuario ya tiene, de un import
 * previo, un movimiento AMORTIZATION para ese instrumento).
 */

import { InstrumentType, TransactionType } from "@/lib/generated/prisma";
import type { NormalizedImportRow } from "./types";

export type AutoClearReason =
  | "cash_movement"
  | "adjustment"
  | "unsupported_instrument"
  | "amortized_ticker";

export const AUTO_CLEAR_REASON_LABELS: Record<AutoClearReason, string> = {
  cash_movement: "depósitos/retiros",
  adjustment: "ajustes",
  unsupported_instrument: "bonos/letras (sin histórico de precios)",
  amortized_ticker: "tickers ya amortizados",
};

const CASH_TYPES = new Set<TransactionType>([
  TransactionType.DEPOSIT,
  TransactionType.WITHDRAWAL,
]);

// BOND_AR y LETRA no tienen serie de precios (Yahoo no cotiza estos tickers):
// ver EXCLUSION_REASONS en src/lib/rendimientos/types.ts.
const UNSUPPORTED_INSTRUMENT_TYPES = new Set<InstrumentType>([
  InstrumentType.BOND_AR,
  InstrumentType.LETRA,
]);

export type AutoClearMatch = {
  rowNumber: number;
  reason: AutoClearReason;
};

export function computeAutoClearMatches(
  rows: NormalizedImportRow[],
  amortizedTickers: ReadonlySet<string>
): AutoClearMatch[] {
  const matches: AutoClearMatch[] = [];

  for (const row of rows) {
    const parsed = row.parsed;
    if (!parsed) continue;

    if (CASH_TYPES.has(parsed.type)) {
      matches.push({ rowNumber: row.rowNumber, reason: "cash_movement" });
      continue;
    }
    if (parsed.type === TransactionType.ADJUSTMENT) {
      matches.push({ rowNumber: row.rowNumber, reason: "adjustment" });
      continue;
    }
    if (parsed.instrumentType && UNSUPPORTED_INSTRUMENT_TYPES.has(parsed.instrumentType)) {
      matches.push({ rowNumber: row.rowNumber, reason: "unsupported_instrument" });
      continue;
    }
    if (parsed.ticker && amortizedTickers.has(parsed.ticker.trim().toUpperCase())) {
      matches.push({ rowNumber: row.rowNumber, reason: "amortized_ticker" });
    }
  }

  return matches;
}

/** Tickers presentes en el archivo, para resolver `amortizedTickers` contra la DB. */
export function collectTickers(rows: NormalizedImportRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    const ticker = row.parsed?.ticker?.trim().toUpperCase();
    if (ticker) set.add(ticker);
  }
  return [...set];
}
