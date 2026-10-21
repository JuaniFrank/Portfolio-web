import { Check, Copy, EyeOff, Pencil, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { InstrumentType, TransactionType } from "@/lib/generated/prisma";
import type { DuplicateRow } from "@/lib/importers/duplicates";
import type { NormalizedImportRow, RowPatch } from "@/lib/importers/types";
import { INSTRUMENT_TYPE_LABELS, TRANSACTION_TYPE_LABELS } from "@/lib/imports/filters";
import {
  dateInputToIso,
  describeDuplicate,
  formatReviewAmount,
  formatReviewDate,
  isoToDateInput,
} from "@/lib/imports/review-view";
import { cn } from "@/lib/utils";

const EDITABLE_INSTRUMENT_TYPES: InstrumentType[] = [
  InstrumentType.CEDEAR,
  InstrumentType.STOCK_AR,
  InstrumentType.BOND_AR,
  InstrumentType.LETRA,
  InstrumentType.ON,
  InstrumentType.CRYPTO,
];

const EDITABLE_CURRENCIES = ["ARS", "USD"];

// ---------------------------------------------------------------------------
// Componente de Fila Unificada
// ---------------------------------------------------------------------------

type UnifiedRowItemProps = {
  row: NormalizedImportRow;
  isExcluded: boolean;
  isEditing: boolean;
  duplicate: DuplicateRow | undefined;
  onToggle: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onPatch: (patch: RowPatch) => void;
  onReset: () => void;
};

export function UnifiedRowItem({
  row,
  isExcluded,
  isEditing,
  duplicate,
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
        {duplicate && (
          <Badge
            variant="outline"
            className="mt-1 gap-1 border-amber-500/30 text-[10px] text-amber-300"
            title={describeDuplicate(duplicate)}
          >
            <Copy className="h-3 w-3" />
            Posible duplicado
          </Badge>
        )}
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
          formatReviewDate(p.tradeDate)
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
          p.price ? formatReviewAmount(p.price) : "—"
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
          formatReviewAmount(p.netAmount)
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
