"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Filter, Pencil, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InstrumentType, TransactionType } from "@/lib/generated/prisma";
import {
  EDITABLE_CURRENCIES,
  EDITABLE_INSTRUMENT_TYPES,
  computeRowStats,
} from "@/lib/importers/row-validation";
import type { NormalizedImportRow, RowPatch } from "@/lib/importers/types";
import { INSTRUMENT_TYPE_LABELS, TRANSACTION_TYPE_LABELS } from "@/lib/imports/filters";
import { cn } from "@/lib/utils";

type Props = {
  rows: NormalizedImportRow[];
  /** rowNumbers excluidos del commit. */
  excluded: ReadonlySet<number>;
  onToggleRow: (rowNumber: number) => void;
  onSetExcluded: (rowNumbers: number[]) => void;
  onPatchRow: (rowNumber: number, patch: RowPatch) => void;
  onResetRow: (rowNumber: number) => void;
};

const STATUS_LABEL = { valid: "OK", warning: "Aviso", invalid: "Error" } as const;
const STATUS_VARIANT = {
  valid: "success",
  warning: "secondary",
  invalid: "destructive",
} as const;

/** El parser ancla las fechas al mediodía UTC para que ningún corrimiento de
 *  zona horaria cambie el día calendario. Las ediciones siguen la misma regla. */
function isoToDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function dateInputToIso(value: string): string {
  return `${value}T12:00:00.000Z`;
}

export function ImportEditTable({
  rows,
  excluded,
  onToggleRow,
  onSetExcluded,
  onPatchRow,
  onResetRow,
}: Props) {
  const [onlyProblems, setOnlyProblems] = useState(false);

  const stats = useMemo(() => computeRowStats(rows, excluded), [rows, excluded]);

  const visibleRows = useMemo(
    () => (onlyProblems ? rows.filter((r) => r.status !== "valid") : rows),
    [rows, onlyProblems]
  );

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

  function excludeInvalid() {
    const invalidNumbers = rows.filter((r) => r.status === "invalid").map((r) => r.rowNumber);
    onSetExcluded([...new Set([...excluded, ...invalidNumbers])]);
  }

  return (
    <div className="space-y-3">
      {/* Barra de estado + acciones masivas */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-zinc-300">
            <span className="font-semibold text-zinc-50">{stats.committable}</span> de {stats.total}{" "}
            se van a importar
          </span>
          {stats.excluded > 0 && (
            <span className="text-zinc-500">{stats.excluded} omitidas</span>
          )}
          {stats.invalid > 0 && (
            <span className="text-red-400">{stats.invalid} con error</span>
          )}
          {stats.warning > 0 && (
            <span className="text-amber-400">{stats.warning} con aviso</span>
          )}
          {stats.edited > 0 && (
            <span className="flex items-center gap-1 text-teal-400">
              <Pencil className="h-3 w-3" />
              {stats.edited} editadas
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={onlyProblems ? "default" : "outline"}
            className="h-8"
            onClick={() => setOnlyProblems((v) => !v)}
          >
            <Filter className="mr-1.5 h-3.5 w-3.5" />
            Solo con problemas
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            onClick={excludeInvalid}
            disabled={stats.invalid === 0}
          >
            Omitir las {stats.invalid} con error
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => onSetExcluded([])}
            disabled={stats.excluded === 0}
          >
            Incluir todas
          </Button>
        </div>
      </div>

      {stats.invalid > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-amber-900/50 bg-amber-950/20 p-3 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Las filas con error no se importan. Corregí los campos marcados en rojo o dejalas
            omitidas — el resto del archivo se importa igual.
          </div>
        </div>
      )}

      <div className="max-h-[min(55vh,460px)] overflow-auto rounded-md border border-zinc-800">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-zinc-950">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-teal-500"
                  checked={allVisibleIncluded}
                  onChange={toggleAllVisible}
                  aria-label={allVisibleIncluded ? "Omitir todas" : "Incluir todas"}
                />
              </TableHead>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="w-24">Estado</TableHead>
              <TableHead className="w-36">Fecha</TableHead>
              <TableHead className="w-44">Tipo</TableHead>
              <TableHead className="w-28">Ticker</TableHead>
              <TableHead className="w-40">Instrumento</TableHead>
              <TableHead className="w-28 text-right">Cant.</TableHead>
              <TableHead className="w-28 text-right">Precio</TableHead>
              <TableHead className="w-32 text-right">Importe</TableHead>
              <TableHead className="w-24">Moneda</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-8 text-center text-sm text-zinc-500">
                  No hay filas con problemas. Buenísimo.
                </TableCell>
              </TableRow>
            ) : (
              visibleRows.map((row) => (
                <EditableRow
                  key={row.rowNumber}
                  row={row}
                  isExcluded={excluded.has(row.rowNumber)}
                  onToggle={() => onToggleRow(row.rowNumber)}
                  onPatch={(patch) => onPatchRow(row.rowNumber, patch)}
                  onReset={() => onResetRow(row.rowNumber)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fila editable
// ---------------------------------------------------------------------------

type EditableRowProps = {
  row: NormalizedImportRow;
  isExcluded: boolean;
  onToggle: () => void;
  onPatch: (patch: RowPatch) => void;
  onReset: () => void;
};

function EditableRow({ row, isExcluded, onToggle, onPatch, onReset }: EditableRowProps) {
  const p = row.parsed;
  const invalid = row.status === "invalid";

  // Una fila que el parser no pudo interpretar no tiene payload editable:
  // mostramos la descripción cruda y solo se puede omitir.
  if (!p) {
    return (
      <TableRow className={cn(isExcluded && "opacity-40")}>
        <TableCell>
          <RowCheckbox checked={!isExcluded} onChange={onToggle} rowNumber={row.rowNumber} />
        </TableCell>
        <TableCell className="text-xs text-zinc-500">{row.rowNumber}</TableCell>
        <TableCell>
          <Badge variant="destructive">Error</Badge>
        </TableCell>
        <TableCell colSpan={9} className="text-xs text-zinc-400">
          <span className="text-red-400">{row.messages[0] ?? "Fila no interpretable"}</span>
          <span className="ml-2 text-zinc-600">· {row.raw.Descripcion}</span>
        </TableCell>
      </TableRow>
    );
  }

  const missingTicker = row.messages.some((m) => m.includes("ticker"));
  const missingInstrumentType = row.messages.some((m) => m.includes("tipo de instrumento"));
  const badDate = row.messages.some((m) => m.toLowerCase().includes("fecha"));
  const badCurrency = row.messages.some((m) => m.toLowerCase().includes("moneda"));
  const badQuantity = row.messages.some((m) => m.toLowerCase().includes("cantidad"));
  const badAmount = row.messages.some((m) => m.toLowerCase().includes("importe"));
  const badPrice = row.messages.some((m) => m.toLowerCase().includes("precio"));

  return (
    <TableRow className={cn(isExcluded && "opacity-40", invalid && !isExcluded && "bg-red-950/10")}>
      <TableCell>
        <RowCheckbox checked={!isExcluded} onChange={onToggle} rowNumber={row.rowNumber} />
      </TableCell>

      <TableCell className="text-xs text-zinc-500">{row.rowNumber}</TableCell>

      <TableCell>
        <div className="flex items-center gap-1">
          <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
          {row.edited && <Pencil className="h-3 w-3 text-teal-400" />}
        </div>
        {row.messages.length > 0 && (
          <p
            className="mt-1 max-w-[140px] truncate text-[10px] text-zinc-500"
            title={row.messages.join("; ")}
          >
            {row.messages[0]}
          </p>
        )}
      </TableCell>

      <TableCell>
        <CellInput
          type="date"
          value={isoToDateInput(p.tradeDate)}
          invalid={badDate}
          onCommit={(v) => v && onPatch({ tradeDate: dateInputToIso(v) })}
        />
      </TableCell>

      <TableCell>
        <CellSelect
          value={p.type}
          invalid={false}
          onChange={(v) => onPatch({ type: v as TransactionType })}
          options={Object.values(TransactionType).map((t) => ({
            value: t,
            label: TRANSACTION_TYPE_LABELS[t],
          }))}
        />
      </TableCell>

      <TableCell>
        <CellInput
          value={p.ticker ?? ""}
          placeholder="—"
          invalid={missingTicker}
          className="font-mono uppercase"
          onCommit={(v) => onPatch({ ticker: v })}
        />
      </TableCell>

      <TableCell>
        <CellSelect
          value={p.instrumentType ?? ""}
          invalid={missingInstrumentType}
          onChange={(v) =>
            onPatch({ instrumentType: v === "" ? null : (v as InstrumentType) })
          }
          options={[
            { value: "", label: "—" },
            ...EDITABLE_INSTRUMENT_TYPES.map((t) => ({
              value: t,
              label: INSTRUMENT_TYPE_LABELS[t] ?? t,
            })),
          ]}
        />
      </TableCell>

      <TableCell>
        <CellInput
          value={p.quantity}
          invalid={badQuantity}
          className="text-right font-mono"
          inputMode="decimal"
          onCommit={(v) => onPatch({ quantity: v })}
        />
      </TableCell>

      <TableCell>
        <CellInput
          value={p.price ?? ""}
          placeholder="—"
          invalid={badPrice}
          className="text-right font-mono"
          inputMode="decimal"
          onCommit={(v) => onPatch({ price: v.trim() === "" ? null : v })}
        />
      </TableCell>

      <TableCell>
        <CellInput
          value={p.netAmount}
          invalid={badAmount}
          className="text-right font-mono"
          inputMode="decimal"
          onCommit={(v) => onPatch({ netAmount: v })}
        />
      </TableCell>

      <TableCell>
        <CellSelect
          value={p.currencyCode}
          invalid={badCurrency}
          onChange={(v) => onPatch({ currencyCode: v })}
          options={EDITABLE_CURRENCIES.map((c) => ({ value: c, label: c }))}
        />
      </TableCell>

      <TableCell>
        {row.edited && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-zinc-500 hover:text-zinc-200"
            onClick={onReset}
            title="Descartar los cambios de esta fila"
            aria-label={`Descartar cambios de la fila ${row.rowNumber}`}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Controles compactos
// ---------------------------------------------------------------------------

function RowCheckbox({
  checked,
  onChange,
  rowNumber,
}: {
  checked: boolean;
  onChange: () => void;
  rowNumber: number;
}) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-teal-500"
      checked={checked}
      onChange={onChange}
      aria-label={`Incluir la fila ${rowNumber} en el import`}
    />
  );
}

/**
 * Input no controlado con commit en blur/Enter.
 *
 * Deliberadamente no controlado: con cientos de filas, propagar cada tecla al
 * estado del modal re-valida y re-renderiza toda la tabla. El `key` sobre el
 * valor externo lo re-sincroniza cuando el patch viene de afuera (reset).
 */
function CellInput({
  value,
  onCommit,
  invalid,
  className,
  type = "text",
  placeholder,
  inputMode,
}: {
  value: string;
  onCommit: (value: string) => void;
  invalid?: boolean;
  className?: string;
  type?: "text" | "date";
  placeholder?: string;
  inputMode?: "decimal" | "text";
}) {
  return (
    <input
      key={value}
      type={type}
      defaultValue={value}
      placeholder={placeholder}
      inputMode={inputMode}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      className={cn(
        "h-7 w-full rounded border bg-zinc-950 px-1.5 text-xs text-zinc-100",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-500",
        invalid ? "border-red-800 bg-red-950/20" : "border-zinc-800",
        className
      )}
    />
  );
}

/** `<select>` nativo: el de Radix abre un portal por celda, que con cientos de
 *  filas es innecesariamente caro y molesto de tabular. */
function CellSelect({
  value,
  onChange,
  options,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  invalid?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-7 w-full rounded border bg-zinc-950 px-1 text-xs text-zinc-100",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-500",
        invalid ? "border-red-800 bg-red-950/20" : "border-zinc-800"
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
