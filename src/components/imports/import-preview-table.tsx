"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { EyeOff, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { computeRowStats } from "@/lib/importers/row-validation";
import type { ImportPreviewSummary, NormalizedImportRow } from "@/lib/importers/types";
import { TRANSACTION_TYPE_LABELS } from "@/lib/imports/filters";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<NormalizedImportRow["status"], string> = {
  valid: "OK",
  warning: "Aviso",
  invalid: "Error",
};

const STATUS_VARIANT: Record<
  NormalizedImportRow["status"],
  "success" | "secondary" | "destructive"
> = {
  valid: "success",
  warning: "secondary",
  invalid: "destructive",
};

function formatDate(iso: string) {
  return format(new Date(iso), "dd/MM/yyyy", { locale: es });
}

function formatAmount(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Props = {
  preview: ImportPreviewSummary;
  /** Copia de trabajo del editor. Si no se pasa, se muestran las filas del parser. */
  rows?: NormalizedImportRow[];
  /** rowNumbers excluidos del commit. */
  excluded?: ReadonlySet<number>;
};

export function ImportPreviewTable({ preview, rows, excluded }: Props) {
  const effectiveRows = rows ?? preview.rows;
  const effectiveExcluded = excluded ?? new Set<number>();
  const stats = computeRowStats(effectiveRows, effectiveExcluded);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
        <span>{stats.total} filas</span>
        <span className="text-emerald-400">{stats.valid} válidas</span>
        {stats.warning > 0 && <span className="text-amber-400">{stats.warning} con aviso</span>}
        {stats.invalid > 0 && <span className="text-red-400">{stats.invalid} con error</span>}
        {stats.excluded > 0 && <span className="text-zinc-500">{stats.excluded} omitidas</span>}
        {stats.edited > 0 && <span className="text-teal-400">{stats.edited} editadas</span>}
        <span className="ml-auto text-zinc-300">
          Se importan <span className="font-semibold text-zinc-50">{stats.committable}</span>
        </span>
      </div>

      <div className="max-h-[min(50vh,420px)] overflow-auto rounded-md border border-zinc-800">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-zinc-950">
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Ticker</TableHead>
              <TableHead className="text-right">Cant.</TableHead>
              <TableHead className="text-right">Importe</TableHead>
              <TableHead>Moneda</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {effectiveRows.map((row) => (
              <PreviewRow
                key={row.rowNumber}
                row={row}
                isExcluded={effectiveExcluded.has(row.rowNumber)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PreviewRow({
  row,
  isExcluded,
}: {
  row: NormalizedImportRow;
  isExcluded: boolean;
}) {
  const p = row.parsed;

  return (
    <TableRow className={cn((row.status === "invalid" || isExcluded) && "opacity-50")}>
      <TableCell className="text-zinc-500">{row.rowNumber}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {isExcluded ? (
            <Badge variant="secondary" className="gap-1">
              <EyeOff className="h-3 w-3" />
              Omitida
            </Badge>
          ) : (
            <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
          )}
          {row.edited && <Pencil className="h-3 w-3 text-teal-400" />}
        </div>
        {row.messages.length > 0 && (
          <p
            className="mt-1 max-w-[140px] truncate text-xs text-zinc-500"
            title={row.messages.join("; ")}
          >
            {row.messages[0]}
          </p>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">
        {p ? formatDate(p.tradeDate) : "—"}
      </TableCell>
      <TableCell className="max-w-[140px] truncate text-xs" title={p?.type}>
        {p ? TRANSACTION_TYPE_LABELS[p.type] : "—"}
      </TableCell>
      <TableCell className="font-mono text-xs">{p?.ticker ?? "—"}</TableCell>
      <TableCell className="text-right font-mono text-xs">{p?.quantity ?? "—"}</TableCell>
      <TableCell className="text-right font-mono text-xs">
        {p ? formatAmount(p.netAmount) : "—"}
      </TableCell>
      <TableCell className="text-xs">{p?.currencyCode ?? "—"}</TableCell>
    </TableRow>
  );
}
