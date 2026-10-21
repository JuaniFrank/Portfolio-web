"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DuplicateRow } from "@/lib/importers/duplicates";
import type {
  ImportPreviewSummary,
  NormalizedImportRow,
  RowPatch,
} from "@/lib/importers/types";
import { HealthTabsBar } from "./review/health-tabs-bar";
import { ReviewFilterBar } from "./review/review-filter-bar";
import { ReviewHeader } from "./review/review-header";
import { UnifiedRowItem } from "./review/unified-row-item";
import { useReviewState } from "./review/use-review-state";

type UnifiedReviewStepProps = {
  preview: ImportPreviewSummary;
  rows: NormalizedImportRow[];
  excluded: Set<number>;
  onToggleRow: (rowNumber: number) => void;
  onSetExcluded: (rowNumbers: number[]) => void;
  onPatchRow: (rowNumber: number, patch: RowPatch) => void;
  onResetRow: (rowNumber: number) => void;
  onConfirmImport: () => void;
  onBackToAutoClear: () => void;
  committing: boolean;
  canCommit: boolean;
  /** Rows flagged as possible duplicates of registered transactions, by row number. */
  duplicateByRow: Map<number, DuplicateRow>;
};

export function UnifiedReviewStep({
  preview,
  rows,
  excluded,
  onToggleRow,
  onSetExcluded,
  onPatchRow,
  onResetRow,
  onConfirmImport,
  onBackToAutoClear,
  committing,
  canCommit,
  duplicateByRow,
}: UnifiedReviewStepProps) {
  const {
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
  } = useReviewState(rows, excluded, onSetExcluded);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <ReviewHeader
        preview={preview}
        stats={stats}
        onBackToAutoClear={onBackToAutoClear}
        onConfirmImport={onConfirmImport}
        committing={committing}
        canCommit={canCommit}
      />

      <HealthTabsBar
        stats={stats}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        excludeAllInvalid={excludeAllInvalid}
        restoreAllExcluded={restoreAllExcluded}
      />

      <ReviewFilterBar
        tickerQuery={tickerQuery}
        setTickerQuery={setTickerQuery}
        typeFilter={typeFilter}
        setTypeFilter={setTypeFilter}
        availableTypes={availableTypes}
        visibleCount={visibleRows.length}
        totalCount={rows.length}
      />

      {/* Tabla Unificada */}
      <div className="max-h-[500px] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/40">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-zinc-950">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-teal-500"
                  checked={allVisibleIncluded}
                  onChange={toggleAllVisible}
                  aria-label="Incluir u omitir visibles"
                />
              </TableHead>
              <TableHead className="w-12 text-xs">#</TableHead>
              <TableHead className="w-24 text-xs">Estado</TableHead>
              <TableHead className="w-32 text-xs">Fecha</TableHead>
              <TableHead className="w-36 text-xs">Tipo</TableHead>
              <TableHead className="w-28 text-xs">Ticker</TableHead>
              <TableHead className="w-36 text-xs">Instrumento</TableHead>
              <TableHead className="w-24 text-right text-xs">Cant.</TableHead>
              <TableHead className="w-28 text-right text-xs">Precio</TableHead>
              <TableHead className="w-32 text-right text-xs">Importe</TableHead>
              <TableHead className="w-16 text-xs">Moneda</TableHead>
              <TableHead className="w-16 text-center text-xs">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-12 text-center text-sm text-zinc-500">
                  No hay movimientos en esta vista.
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((row) => {
                const isExcluded = excluded.has(row.rowNumber);
                const isEditing = editingRowNumber === row.rowNumber;

                return (
                  <UnifiedRowItem
                    key={row.rowNumber}
                    row={row}
                    isExcluded={isExcluded}
                    isEditing={isEditing}
                    duplicate={duplicateByRow.get(row.rowNumber)}
                    onToggle={() => onToggleRow(row.rowNumber)}
                    onStartEdit={() => setEditingRowNumber(row.rowNumber)}
                    onStopEdit={() => setEditingRowNumber(null)}
                    onPatch={(patch) => onPatchRow(row.rowNumber, patch)}
                    onReset={() => onResetRow(row.rowNumber)}
                  />
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
