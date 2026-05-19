"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ImportPreviewSummary, NormalizedImportRow } from "@/lib/importers/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<NormalizedImportRow["status"], string> = {
  valid: "OK",
  warning: "Aviso",
  invalid: "Error",
};

const STATUS_VARIANT: Record<
  NormalizedImportRow["status"],
  "default" | "secondary" | "destructive"
> = {
  valid: "default",
  warning: "secondary",
  invalid: "destructive",
};

function formatDate(iso: string) {
  return format(new Date(iso), "dd/MM/yyyy", { locale: es });
}

function formatAmount(value: string) {
  const n = Number(value);
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ImportPreviewTable({ preview }: { preview: ImportPreviewSummary }) {
  const { stats } = preview;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm text-zinc-400">
        <span>{stats.total} filas</span>
        <span className="text-emerald-400">{stats.valid} válidas</span>
        {stats.warning > 0 && <span className="text-amber-400">{stats.warning} con aviso</span>}
        {stats.invalid > 0 && <span className="text-red-400">{stats.invalid} con error</span>}
      </div>

      <div className="max-h-[min(50vh,420px)] overflow-auto rounded-md border border-zinc-800">
        <Table>
          <TableHeader>
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
            {preview.rows.map((row) => (
              <PreviewRow key={row.rowNumber} row={row} />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PreviewRow({ row }: { row: NormalizedImportRow }) {
  const p = row.parsed;

  return (
    <TableRow className={cn(row.status === "invalid" && "opacity-60")}>
      <TableCell className="text-zinc-500">{row.rowNumber}</TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABEL[row.status]}</Badge>
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
      <TableCell className="max-w-[120px] truncate text-xs" title={p?.type}>
        {p?.type ?? "—"}
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
