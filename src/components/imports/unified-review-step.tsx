"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  Check,
  EyeOff,
  Filter,
  Pencil,
  RotateCcw,
  Search,
  Sparkles,
  X,
  ArrowLeft,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InstrumentType, TransactionType } from "@/lib/generated/prisma";
import { computeRowStats } from "@/lib/importers/row-validation";
import type {
  ImportPreviewSummary,
  NormalizedImportRow,
  RowPatch,
} from "@/lib/importers/types";
import {
  INSTRUMENT_TYPE_LABELS,
  TRANSACTION_TYPE_LABELS,
} from "@/lib/imports/filters";
import { cn } from "@/lib/utils";

type HealthTab = "committable" | "excluded" | "problems" | "all";

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
  checkingDuplicates: boolean;
  canCommit: boolean;
};

function formatDate(iso: string) {
  try {
    return format(new Date(iso), "dd/MM/yyyy", { locale: es });
  } catch {
    return iso;
  }
}

function formatAmount(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isoToDateInput(iso: string): string {
  return iso.slice(0, 10);
}

function dateInputToIso(value: string): string {
  return `${value}T12:00:00.000Z`;
}

const EDITABLE_INSTRUMENT_TYPES: InstrumentType[] = [
  InstrumentType.CEDEAR,
  InstrumentType.STOCK_AR,
  InstrumentType.BOND_AR,
  InstrumentType.LETRA,
  InstrumentType.ON,
  InstrumentType.CRYPTO,
];

const EDITABLE_CURRENCIES = ["ARS", "USD"];

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
  checkingDuplicates,
  canCommit,
}: UnifiedReviewStepProps) {
  const [activeTab, setActiveTab] = useState<HealthTab>("committable");
  const [tickerQuery, setTickerQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [editingRowNumber, setEditingRowNumber] = useState<number | null>(null);

  const stats = useMemo(() => computeRowStats(rows, excluded), [rows, excluded]);

  // Tipos disponibles en el archivo
  const availableTypes = useMemo(() => {
    const set = new Set<TransactionType>();
    rows.forEach((r) => {
      if (r.parsed) set.add(r.parsed.type);
    });
    return Array.from(set).sort((a, b) =>
      TRANSACTION_TYPE_LABELS[a].localeCompare(TRANSACTION_TYPE_LABELS[b])
    );
  }, [rows]);

  // Filtrado de filas
  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      const isExcluded = excluded.has(r.rowNumber);
      const isProblem = r.status === "invalid" || r.status === "warning";

      // Filtro por tab de salud
      if (activeTab === "committable" && (isExcluded || r.status === "invalid")) return false;
      if (activeTab === "excluded" && !isExcluded) return false;
      if (activeTab === "problems" && !isProblem) return false;

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
  }, [rows, excluded, activeTab, tickerQuery, typeFilter]);

  const allVisibleIncluded =
    visibleRows.length > 0 && visibleRows.every((r) => !excluded.has(r.rowNumber));

  function toggleAllVisible() {
    const visibleNumbers = visibleRows.map((r) => r.rowNumber);
    if (allVisibleIncluded) {
      onSetExcluded([...excluded, ...visibleNumbers]);
    } else {
      const keep = [...excluded].filter((n) => !visibleNumbers.includes(n));
      onSetExcluded(keep);
    }
  }

  function excludeAllInvalid() {
    const invalidNumbers = rows.filter((r) => r.status === "invalid").map((r) => r.rowNumber);
    onSetExcluded([...new Set([...excluded, ...invalidNumbers])]);
  }

  function restoreAllExcluded() {
    onSetExcluded([]);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Encabezado */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
            Paso 3: Revisión y Conciliación
          </h2>
          <p className="text-xs text-zinc-400">
            Archivo: <span className="font-medium text-zinc-200">{preview.fileName}</span> ·{" "}
            {stats.total} movimientos totales
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onBackToAutoClear}>
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            Volver al Auto-Clear
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={onConfirmImport}
            disabled={!canCommit || checkingDuplicates}
            className="gap-1.5"
          >
            {checkingDuplicates ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Verificando duplicados…
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Importar {stats.committable} movimientos
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Barra de Tabs de Salud */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("committable")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "committable"
                ? "bg-teal-500/10 text-teal-400 border border-teal-500/30"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            )}
          >
            <span>Para importar</span>
            <Badge variant="outline" className="ml-1 h-5 text-[10px] border-teal-500/30 text-teal-400">
              {stats.committable}
            </Badge>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("excluded")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "excluded"
                ? "bg-zinc-800 text-zinc-200 border border-zinc-700"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            )}
          >
            <span>Omitidas</span>
            <Badge variant="outline" className="ml-1 h-5 text-[10px] text-zinc-400">
              {stats.excluded}
            </Badge>
          </button>

          {(stats.invalid > 0 || stats.warning > 0) && (
            <button
              type="button"
              onClick={() => setActiveTab("problems")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === "problems"
                  ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                  : "text-amber-400/80 hover:text-amber-300 hover:bg-zinc-900"
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Con avisos o errores</span>
              <Badge variant="destructive" className="ml-1 h-5 text-[10px]">
                {stats.invalid + stats.warning}
              </Badge>
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "all"
                ? "bg-zinc-800 text-zinc-200 border border-zinc-700"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
            )}
          >
            <span>Todas</span>
            <Badge variant="outline" className="ml-1 h-5 text-[10px] text-zinc-400">
              {stats.total}
            </Badge>
          </button>
        </div>

        {/* Acciones masivas */}
        <div className="flex items-center gap-2">
          {stats.invalid > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={excludeAllInvalid}
            >
              Omitir las {stats.invalid} con error
            </Button>
          )}

          {stats.excluded > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-zinc-400 hover:text-zinc-100"
              onClick={restoreAllExcluded}
            >
              Reincorporar todas ({stats.excluded})
            </Button>
          )}
        </div>
      </div>

      {/* Buscador y Filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <Input
              value={tickerQuery}
              onChange={(e) => setTickerQuery(e.target.value)}
              placeholder="Buscar ticker…"
              className="h-8 w-44 pl-8 text-xs bg-zinc-950/60"
            />
          </div>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 w-44 text-xs bg-zinc-950/60">
              <SelectValue placeholder="Tipo de operación" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los tipos</SelectItem>
              {availableTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {TRANSACTION_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(tickerQuery || typeFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setTickerQuery("");
                setTypeFilter("all");
              }}
              className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200"
            >
              <X className="h-3 w-3" />
              Limpiar filtros
            </button>
          )}
        </div>

        <p className="text-[11px] text-zinc-500">
          Mostrando {visibleRows.length} de {rows.length} filas
        </p>
      </div>

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

// ---------------------------------------------------------------------------
// Componente de Fila Unificada
// ---------------------------------------------------------------------------

type UnifiedRowItemProps = {
  row: NormalizedImportRow;
  isExcluded: boolean;
  isEditing: boolean;
  onToggle: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onPatch: (patch: RowPatch) => void;
  onReset: () => void;
};

function UnifiedRowItem({
  row,
  isExcluded,
  isEditing,
  onToggle,
  onStartEdit,
  onStopEdit,
  onPatch,
  onReset,
}: UnifiedRowItemProps) {
  const p = row.parsed;
  const isInvalid = row.status === "invalid";
  const isWarning = row.status === "warning";

  if (!p) {
    return (
      <TableRow className={cn(isExcluded && "opacity-40 bg-zinc-950/20")}>
        <TableCell>
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-teal-500"
            checked={!isExcluded}
            onChange={onToggle}
          />
        </TableCell>
        <TableCell className="text-xs font-mono text-zinc-500">{row.rowNumber}</TableCell>
        <TableCell>
          <Badge variant="destructive" className="text-[10px]">Error</Badge>
        </TableCell>
        <TableCell colSpan={9} className="text-xs text-zinc-400">
          <span className="text-red-400">{row.messages[0] ?? "Fila no interpretable"}</span>
          <span className="ml-2 text-zinc-600">· {row.raw.Descripcion}</span>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow
      className={cn(
        "text-xs transition-colors",
        isExcluded && "opacity-40 bg-zinc-950/20",
        isInvalid && !isExcluded && "bg-red-950/15",
        isWarning && !isExcluded && "bg-amber-950/10",
        isEditing && "bg-teal-950/20"
      )}
    >
      <TableCell>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-teal-500"
          checked={!isExcluded}
          onChange={onToggle}
        />
      </TableCell>

      <TableCell className="font-mono text-zinc-500">{row.rowNumber}</TableCell>

      <TableCell>
        <div className="flex items-center gap-1">
          {isExcluded ? (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <EyeOff className="h-3 w-3" />
              Omitida
            </Badge>
          ) : isInvalid ? (
            <Badge variant="destructive" className="text-[10px]">Error</Badge>
          ) : isWarning ? (
            <Badge variant="secondary" className="text-[10px] text-amber-300">Aviso</Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30">
              OK
            </Badge>
          )}
          {row.edited && <Pencil className="h-3 w-3 text-teal-400" />}
        </div>
        {row.messages.length > 0 && !isExcluded && (
          <p className="mt-0.5 max-w-[120px] truncate text-[10px] text-zinc-500" title={row.messages.join("; ")}>
            {row.messages[0]}
          </p>
        )}
      </TableCell>

      {/* Fecha */}
      <TableCell className="whitespace-nowrap">
        {isEditing ? (
          <input
            type="date"
            defaultValue={isoToDateInput(p.tradeDate)}
            onChange={(e) => e.target.value && onPatch({ tradeDate: dateInputToIso(e.target.value) })}
            className="h-7 w-28 rounded border border-zinc-700 bg-zinc-900 px-1 text-xs text-zinc-100"
          />
        ) : (
          formatDate(p.tradeDate)
        )}
      </TableCell>

      {/* Tipo */}
      <TableCell>
        {isEditing ? (
          <select
            value={p.type}
            onChange={(e) => onPatch({ type: e.target.value as TransactionType })}
            className="h-7 rounded border border-zinc-700 bg-zinc-900 px-1 text-xs text-zinc-100"
          >
            {Object.values(TransactionType).map((t) => (
              <option key={t} value={t}>
                {TRANSACTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        ) : (
          TRANSACTION_TYPE_LABELS[p.type]
        )}
      </TableCell>

      {/* Ticker */}
      <TableCell className="font-mono font-medium text-zinc-200">
        {isEditing ? (
          <input
            defaultValue={p.ticker ?? ""}
            onBlur={(e) => onPatch({ ticker: e.target.value.trim().toUpperCase() })}
            className="h-7 w-20 rounded border border-zinc-700 bg-zinc-900 px-1.5 font-mono uppercase text-xs text-zinc-100"
          />
        ) : (
          p.ticker ?? "—"
        )}
      </TableCell>

      {/* Instrumento */}
      <TableCell>
        {isEditing ? (
          <select
            value={p.instrumentType ?? ""}
            onChange={(e) =>
              onPatch({ instrumentType: e.target.value ? (e.target.value as InstrumentType) : null })
            }
            className="h-7 rounded border border-zinc-700 bg-zinc-900 px-1 text-xs text-zinc-100"
          >
            <option value="">—</option>
            {EDITABLE_INSTRUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {INSTRUMENT_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        ) : p.instrumentType ? (
          INSTRUMENT_TYPE_LABELS[p.instrumentType] ?? p.instrumentType
        ) : (
          "—"
        )}
      </TableCell>

      {/* Cantidad */}
      <TableCell className="text-right font-mono">
        {isEditing ? (
          <input
            defaultValue={p.quantity}
            onBlur={(e) => onPatch({ quantity: e.target.value })}
            className="h-7 w-20 rounded border border-zinc-700 bg-zinc-900 px-1 text-right font-mono text-xs text-zinc-100"
          />
        ) : (
          p.quantity
        )}
      </TableCell>

      {/* Precio */}
      <TableCell className="text-right font-mono text-zinc-400">
        {isEditing ? (
          <input
            defaultValue={p.price ?? ""}
            placeholder="—"
            onBlur={(e) => onPatch({ price: e.target.value ? e.target.value : null })}
            className="h-7 w-20 rounded border border-zinc-700 bg-zinc-900 px-1 text-right font-mono text-xs text-zinc-100"
          />
        ) : (
          p.price ? formatAmount(p.price) : "—"
        )}
      </TableCell>

      {/* Importe */}
      <TableCell className="text-right font-mono font-medium text-zinc-100">
        {isEditing ? (
          <input
            defaultValue={p.netAmount}
            onBlur={(e) => onPatch({ netAmount: e.target.value })}
            className="h-7 w-24 rounded border border-zinc-700 bg-zinc-900 px-1 text-right font-mono text-xs text-zinc-100"
          />
        ) : (
          formatAmount(p.netAmount)
        )}
      </TableCell>

      {/* Moneda */}
      <TableCell className="font-mono text-zinc-400">
        {isEditing ? (
          <select
            value={p.currencyCode}
            onChange={(e) => onPatch({ currencyCode: e.target.value })}
            className="h-7 rounded border border-zinc-700 bg-zinc-900 px-1 text-xs text-zinc-100"
          >
            {EDITABLE_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          p.currencyCode
        )}
      </TableCell>

      {/* Botón de edición / reset */}
      <TableCell className="text-center">
        {isEditing ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-teal-400"
            onClick={onStopEdit}
            title="Guardar edición rápida"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
        ) : row.edited ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-zinc-500 hover:text-zinc-200"
            onClick={onReset}
            title="Revertir cambios a los originales"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-zinc-500 hover:text-zinc-200"
            onClick={onStartEdit}
            title="Editar fila"
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
