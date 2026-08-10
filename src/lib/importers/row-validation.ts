/**
 * Re-validation of manually edited import rows.
 *
 * The broker parsers (balanz.ts) produce NormalizedImportRow with a status
 * derived from what the file contained. Once the user edits a row in the
 * preview editor, that status is stale — this module recomputes it from the
 * edited payload alone, with no knowledge of the originating broker.
 *
 * Pure functions: no I/O, no Prisma runtime imports beyond the generated enums.
 */

import Decimal from "decimal.js";
import { InstrumentType, TransactionType } from "@/lib/generated/prisma";
import type {
  ImportRowStatus,
  NormalizedImportRow,
  ParsedImportRowData,
  RowPatch,
} from "./types";

/** Currencies the app can persist today (matches the Currency seed + UI selects). */
export const EDITABLE_CURRENCIES = ["ARS", "USD"] as const;

/**
 * Transaction types that never reference an instrument. Mirrors the private
 * `needsInstrument` in balanz.ts — kept here so the editor can validate rows
 * whose type the user changed after parsing.
 */
const NO_INSTRUMENT_TYPES: TransactionType[] = [
  TransactionType.DEPOSIT,
  TransactionType.WITHDRAWAL,
  TransactionType.ADJUSTMENT,
  TransactionType.TAX_WITHHOLDING,
  TransactionType.FEE,
];

export function needsInstrument(type: TransactionType): boolean {
  return !NO_INSTRUMENT_TYPES.includes(type);
}

/** Instrument types offered in the editor. Superset of TRADE_INSTRUMENT_TYPES:
 *  the importer legitimately produces BOND_AR/LETRA/FCI rows even though the
 *  transactions page does not display them yet. */
export const EDITABLE_INSTRUMENT_TYPES: InstrumentType[] = [
  InstrumentType.CEDEAR,
  InstrumentType.STOCK_AR,
  InstrumentType.ON,
  InstrumentType.BOND_AR,
  InstrumentType.LETRA,
  InstrumentType.FCI,
];

function isFiniteDecimalString(value: string | null | undefined): boolean {
  if (value === null || value === undefined || value.trim() === "") return false;
  try {
    const d = new Decimal(value);
    return d.isFinite();
  } catch {
    return false;
  }
}

function isValidIsoDate(value: string | null | undefined): boolean {
  if (!value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

export type RowValidation = {
  status: ImportRowStatus;
  messages: string[];
};

/**
 * Validate a parsed row payload on its own terms.
 *
 * Blocking problems ("Falta …", "… inválido") yield `invalid`; advisory ones
 * yield `warning`. The prefix convention matches balanz.ts so both paths agree
 * on what blocks a commit.
 */
export function validateParsedRow(parsed: ParsedImportRowData): RowValidation {
  const messages: string[] = [];
  let blocking = false;

  if (!Object.values(TransactionType).includes(parsed.type)) {
    messages.push("Tipo de movimiento inválido");
    blocking = true;
  }

  if (!isValidIsoDate(parsed.tradeDate)) {
    messages.push("Fecha de concertación inválida");
    blocking = true;
  }

  if (parsed.settlementDate && !isValidIsoDate(parsed.settlementDate)) {
    messages.push("Fecha de liquidación inválida");
    blocking = true;
  }

  if (!EDITABLE_CURRENCIES.includes(parsed.currencyCode as (typeof EDITABLE_CURRENCIES)[number])) {
    messages.push(`Moneda no soportada: "${parsed.currencyCode}"`);
    blocking = true;
  }

  const requiresInstrument = needsInstrument(parsed.type);

  if (requiresInstrument && !parsed.ticker?.trim()) {
    messages.push("Falta ticker para este movimiento");
    blocking = true;
  }

  if (requiresInstrument && parsed.ticker?.trim() && !parsed.instrumentType) {
    messages.push("Falta tipo de instrumento");
    blocking = true;
  }

  if (!isFiniteDecimalString(parsed.quantity)) {
    messages.push("Cantidad inválida");
    blocking = true;
  } else if (requiresInstrument && new Decimal(parsed.quantity).lte(0)) {
    // A holdings-affecting movement with zero quantity is almost always a
    // parsing miss, but we let it through as a warning: some brokers report
    // fee-only adjustments against an instrument.
    messages.push("Cantidad en cero para un movimiento con instrumento");
  }

  if (parsed.price !== null && !isFiniteDecimalString(parsed.price)) {
    messages.push("Precio inválido");
    blocking = true;
  }

  if (!isFiniteDecimalString(parsed.netAmount)) {
    messages.push("Importe inválido");
    blocking = true;
  }

  if (!isFiniteDecimalString(parsed.grossAmount)) {
    messages.push("Importe bruto inválido");
    blocking = true;
  }

  const status: ImportRowStatus = blocking
    ? "invalid"
    : messages.length > 0
      ? "warning"
      : "valid";

  return { status, messages };
}

/**
 * Apply a user edit to a row and recompute its status.
 *
 * Returns the row untouched when it has no `parsed` payload (a row the parser
 * could not interpret at all is not editable — there is nothing to patch).
 * `edited` is set so the UI can flag manually-touched rows and the commit can
 * record how many were corrected by hand.
 */
export function applyRowPatch(
  row: NormalizedImportRow,
  patch: RowPatch
): NormalizedImportRow {
  if (!row.parsed) return row;

  const next: ParsedImportRowData = {
    ...row.parsed,
    ...patch,
    // Normalize the ticker the same way the rest of the pipeline expects it.
    ticker:
      patch.ticker !== undefined
        ? (patch.ticker?.trim().toUpperCase() ?? "") || null
        : row.parsed.ticker,
  };

  // Derive the settlement date from the trade date when the user moves the
  // trade date and the two were previously in sync.
  if (patch.tradeDate && row.parsed.settlementDate === row.parsed.tradeDate) {
    next.settlementDate = patch.tradeDate;
  }

  // Keep gross in sync with net unless the user edited gross explicitly. The
  // Balanz parser sets both from the same "Importe" column, so an edit to one
  // that leaves the other behind produces a silently inconsistent row.
  if (patch.netAmount !== undefined && patch.grossAmount === undefined) {
    next.grossAmount = patch.netAmount;
  }

  const { status, messages } = validateParsedRow(next);

  return { ...row, parsed: next, status, messages, edited: true };
}

/** Counts used by the editor header and the commit summary. */
export type RowSelectionStats = {
  total: number;
  included: number;
  excluded: number;
  valid: number;
  warning: number;
  invalid: number;
  edited: number;
  /** Rows that will actually be sent to the server. */
  committable: number;
};

export function computeRowStats(
  rows: NormalizedImportRow[],
  excluded: ReadonlySet<number>
): RowSelectionStats {
  let included = 0;
  let valid = 0;
  let warning = 0;
  let invalid = 0;
  let edited = 0;
  let committable = 0;

  for (const row of rows) {
    const isExcluded = excluded.has(row.rowNumber);
    if (!isExcluded) included += 1;
    if (row.edited) edited += 1;

    if (row.status === "valid") valid += 1;
    else if (row.status === "warning") warning += 1;
    else invalid += 1;

    if (!isExcluded && row.status !== "invalid" && row.parsed) committable += 1;
  }

  return {
    total: rows.length,
    included,
    excluded: rows.length - included,
    valid,
    warning,
    invalid,
    edited,
    committable,
  };
}
