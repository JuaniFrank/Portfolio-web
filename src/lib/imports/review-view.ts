import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { TransactionType } from "@/lib/generated/prisma";
import type { DuplicateRow } from "@/lib/importers/duplicates";
import type { NormalizedImportRow } from "@/lib/importers/types";
import { TRANSACTION_TYPE_LABELS } from "@/lib/imports/filters";

/** Pure view logic of the import review step (filtering, bulk exclusion, formatting). */

export type HealthTab = "committable" | "excluded" | "problems" | "all";

export type ReviewFilters = {
  tab: HealthTab;
  tickerQuery: string;
  /** A `TransactionType` or `"all"`. */
  typeFilter: string;
};

export function filterReviewRows(
  rows: NormalizedImportRow[],
  excluded: Set<number>,
  { tab, tickerQuery, typeFilter }: ReviewFilters
): NormalizedImportRow[] {
  return rows.filter((r) => {
    const isExcluded = excluded.has(r.rowNumber);
    const isProblem = r.status === "invalid" || r.status === "warning";

    // Filtro por tab de salud
    if (tab === "committable" && (isExcluded || r.status === "invalid")) return false;
    if (tab === "excluded" && !isExcluded) return false;
    if (tab === "problems" && !isProblem) return false;

    // Filtro por ticker
    if (tickerQuery.trim()) {
      const q = tickerQuery.trim().toUpperCase();
      if (!(r.parsed?.ticker ?? "").toUpperCase().includes(q)) return false;
    }

    // Filtro por tipo de transacción
    if (typeFilter !== "all" && r.parsed?.type !== typeFilter) {
      return false;
    }

    return true;
  });
}

/** Transaction types present in the file, sorted by their Spanish label. */
export function availableTransactionTypes(rows: NormalizedImportRow[]): TransactionType[] {
  const set = new Set<TransactionType>();
  rows.forEach((r) => {
    if (r.parsed) set.add(r.parsed.type);
  });
  return Array.from(set).sort((a, b) =>
    TRANSACTION_TYPE_LABELS[a].localeCompare(TRANSACTION_TYPE_LABELS[b])
  );
}

/**
 * New exclusion list after the header checkbox: if every visible row is included they all
 * get excluded, otherwise the visible rows are re-included.
 */
export function toggleVisibleExcluded(
  excluded: Set<number>,
  visibleNumbers: number[],
  allVisibleIncluded: boolean
): number[] {
  if (allVisibleIncluded) {
    return [...excluded, ...visibleNumbers];
  }
  return [...excluded].filter((n) => !visibleNumbers.includes(n));
}

/** Exclusion list that also omits every row with an error. */
export function excludeInvalidRows(rows: NormalizedImportRow[], excluded: Set<number>): number[] {
  const invalidNumbers = rows.filter((r) => r.status === "invalid").map((r) => r.rowNumber);
  return [...new Set([...excluded, ...invalidNumbers])];
}

export function formatReviewDate(iso: string): string {
  try {
    return format(new Date(iso), "dd/MM/yyyy", { locale: es });
  } catch {
    return iso;
  }
}

export function describeDuplicate(dup: DuplicateRow): string {
  const when = formatReviewDate(dup.existing.createdAt);
  const from = dup.existing.fileName ? ` desde "${dup.existing.fileName}"` : "";
  return `Ya registrado el ${when}${from}`;
}

export function formatReviewAmount(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function isoToDateInput(iso: string): string {
  return iso.slice(0, 10);
}

export function dateInputToIso(value: string): string {
  return `${value}T12:00:00.000Z`;
}
