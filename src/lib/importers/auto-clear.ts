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

export interface AutoClearCategoryMeta {
  reason: AutoClearReason;
  title: string;
  description: string;
  badge: string;
  recommended: boolean;
}

export const AUTO_CLEAR_CATEGORIES: Record<AutoClearReason, AutoClearCategoryMeta> = {
  cash_movement: {
    reason: "cash_movement",
    title: "Movimientos de liquidez",
    description: "Depósitos y transferencias de dinero. No representan compra/venta de activos ni afectan la rentabilidad de las inversiones.",
    badge: "Efectivo",
    recommended: true,
  },
  unsupported_instrument: {
    reason: "unsupported_instrument",
    title: "Instrumentos sin cotización de mercado",
    description: "Bonos soberanos y letras en pesos que no cotizan en Yahoo Finance. Omitirlos evita distorsiones o valuaciones en cero.",
    badge: "Sin cotización",
    recommended: true,
  },
  amortized_ticker: {
    reason: "amortized_ticker",
    title: "Tickers amortizados",
    description: "Títulos que ya fueron amortizados en su totalidad en tu cuenta anteriormente.",
    badge: "Amortizado",
    recommended: true,
  },
  adjustment: {
    reason: "adjustment",
    title: "Ajustes contables del broker",
    description: "Ajustes de saldo interno, comisiones aisladas o movimientos manuales informados por el broker.",
    badge: "Ajuste",
    recommended: true,
  },
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

export interface AutoClearSummary {
  matches: AutoClearMatch[];
  byCategory: Record<AutoClearReason, number[]>;
  counts: Record<AutoClearReason, number>;
  totalExcluded: number;
}

export function computeAutoClearSummary(
  rows: NormalizedImportRow[],
  amortizedTickers: ReadonlySet<string>
): AutoClearSummary {
  const matches = computeAutoClearMatches(rows, amortizedTickers);
  const byCategory: Record<AutoClearReason, number[]> = {
    cash_movement: [],
    unsupported_instrument: [],
    amortized_ticker: [],
    adjustment: [],
  };
  const counts: Record<AutoClearReason, number> = {
    cash_movement: 0,
    unsupported_instrument: 0,
    amortized_ticker: 0,
    adjustment: 0,
  };

  for (const match of matches) {
    byCategory[match.reason].push(match.rowNumber);
    counts[match.reason]++;
  }

  return {
    matches,
    byCategory,
    counts,
    totalExcluded: matches.length,
  };
}

export function getExcludedRowNumbersForCategories(
  summary: AutoClearSummary,
  activeCategories: ReadonlySet<AutoClearReason>
): number[] {
  const excluded: number[] = [];
  for (const reason of activeCategories) {
    const rowNumbers = summary.byCategory[reason];
    if (rowNumbers) {
      excluded.push(...rowNumbers);
    }
  }
  return [...new Set(excluded)];
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
