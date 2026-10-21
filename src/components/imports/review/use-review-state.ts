import { useMemo, useState } from "react";
import { computeRowStats } from "@/lib/importers/row-validation";
import type { NormalizedImportRow } from "@/lib/importers/types";
import {
  availableTransactionTypes,
  excludeInvalidRows,
  filterReviewRows,
  toggleVisibleExcluded,
  type HealthTab,
} from "@/lib/imports/review-view";

/**
 * Estado de la revisión (pestaña, filtros, fila en edición) y los datos derivados de las
 * filas. La lógica pura vive en `lib/imports/review-view.ts`.
 */
export function useReviewState(
  rows: NormalizedImportRow[],
  excluded: Set<number>,
  onSetExcluded: (rowNumbers: number[]) => void
) {
  const [activeTab, setActiveTab] = useState<HealthTab>("committable");
  const [tickerQuery, setTickerQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [editingRowNumber, setEditingRowNumber] = useState<number | null>(null);

  const stats = useMemo(() => computeRowStats(rows, excluded), [rows, excluded]);

  // Tipos disponibles en el archivo
  const availableTypes = useMemo(() => availableTransactionTypes(rows), [rows]);

  // Filtrado de filas
  const visibleRows = useMemo(
    () => filterReviewRows(rows, excluded, { tab: activeTab, tickerQuery, typeFilter }),
    [rows, excluded, activeTab, tickerQuery, typeFilter]
  );

  const allVisibleIncluded =
    visibleRows.length > 0 && visibleRows.every((r) => !excluded.has(r.rowNumber));

  function toggleAllVisible() {
    const visibleNumbers = visibleRows.map((r) => r.rowNumber);
    onSetExcluded(toggleVisibleExcluded(excluded, visibleNumbers, allVisibleIncluded));
  }

  function excludeAllInvalid() {
    onSetExcluded(excludeInvalidRows(rows, excluded));
  }

  function restoreAllExcluded() {
    onSetExcluded([]);
  }

  return {
    activeTab,
    setActiveTab,
    tickerQuery,
    setTickerQuery,
    typeFilter,
    setTypeFilter,
    editingRowNumber,
    setEditingRowNumber,
    stats,
    availableTypes,
    visibleRows,
    allVisibleIncluded,
    toggleAllVisible,
    excludeAllInvalid,
    restoreAllExcluded,
  };
}
