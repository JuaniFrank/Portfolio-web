"use client";

import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, FileWarning, ChevronDown, Check, Copy } from "lucide-react";
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
import type { DuplicateCheckResult } from "@/lib/importers/duplicates";
import type { DuplicateStrategy } from "@/lib/importers/types";
import { TRANSACTION_TYPE_LABELS } from "@/lib/imports/filters";
import { cn } from "@/lib/utils";

type DuplicateResolutionSectionProps = {
  result: DuplicateCheckResult;
  strategy: DuplicateStrategy;
  onStrategyChange: (strategy: DuplicateStrategy) => void;
};

function formatDate(iso: string) {
  try {
    return format(new Date(iso), "dd/MM/yyyy", { locale: es });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string) {
  try {
    return format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: es });
  } catch {
    return iso;
  }
}

function formatAmount(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DuplicateResolutionSection({
  result,
  strategy,
  onStrategyChange,
}: DuplicateResolutionSectionProps) {
  const [showTable, setShowTable] = useState(false);
  const { sameFileBatches, duplicateRows, freshCount, totalCount } = result;
  const duplicateCount = duplicateRows.length;

  return (
    <div className="space-y-4 rounded-xl border border-amber-500/30 bg-amber-950/10 p-5">
      {/* Alerta y Encabezado */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-amber-200">
            Detectamos operaciones que ya existen en tu cartera
          </h3>
          <p className="text-xs leading-relaxed text-zinc-300">
            Encontramos <strong className="text-amber-300">{duplicateCount}</strong> movimientos que
            coinciden exactamente (mismo instrumento, fecha, importe y cantidad) con operaciones ya
            registradas.
          </p>
        </div>
      </div>

      {/* Si el archivo ya se importó antes */}
      {sameFileBatches.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-900/60 bg-amber-950/40 p-3 text-xs text-amber-100">
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium text-amber-200">
              Este archivo exacto ya fue importado {sameFileBatches.length === 1 ? "anteriormente" : `${sameFileBatches.length} veces`}:
            </p>
            <p className="mt-0.5 text-zinc-400">
              Lote: <span className="font-mono text-zinc-300">{sameFileBatches[0]?.fileName}</span> ·{" "}
              {sameFileBatches[0] && formatDateTime(sameFileBatches[0].committedAt ?? sameFileBatches[0].createdAt)}
            </p>
          </div>
        </div>
      )}

      {/* Opciones de Resolución (Tarjetas tipo Radio) */}
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onStrategyChange("skip")}
          className={cn(
            "flex flex-col text-left p-3.5 rounded-lg border transition-all",
            strategy === "skip"
              ? "border-teal-500/60 bg-teal-950/20 ring-1 ring-teal-500/40"
              : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-100">
              Omitir duplicados (Recomendado)
            </span>
            {strategy === "skip" && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-teal-500 text-zinc-950">
                <Check className="h-3 w-3 stroke-[3]" />
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Se importarán únicamente los <strong className="text-teal-300">{freshCount}</strong>{" "}
            movimientos nuevos. Las {duplicateCount} filas repetidas se ignorarán.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onStrategyChange("import")}
          className={cn(
            "flex flex-col text-left p-3.5 rounded-lg border transition-all",
            strategy === "import"
              ? "border-amber-500/60 bg-amber-950/20 ring-1 ring-amber-500/40"
              : "border-zinc-800 bg-zinc-950/40 hover:border-zinc-700"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-100">
              Importar todos de todos modos
            </span>
            {strategy === "import" && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-zinc-950">
                <Check className="h-3 w-3 stroke-[3]" />
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-400">
            Inserta las <strong className="text-amber-300">{totalCount}</strong> filas en tu cartera
            como transacciones adicionales.
          </p>
        </button>
      </div>

      {/* Botón para ver detalle de duplicados */}
      {duplicateCount > 0 && (
        <div className="pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowTable(!showTable)}
            className="h-8 text-xs text-zinc-400 hover:text-zinc-200"
          >
            <ChevronDown
              className={cn("mr-1.5 h-3.5 w-3.5 transition-transform", showTable && "rotate-180")}
            />
            {showTable ? "Ocultar detalle de duplicados" : `Ver las ${duplicateCount} filas repetidas`}
          </Button>

          {showTable && (
            <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/60">
              <Table>
                <TableHeader className="sticky top-0 bg-zinc-950">
                  <TableRow className="text-xs">
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Ticker</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                    <TableHead>Ya importada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {duplicateRows.map((d) => (
                    <TableRow key={`${d.idempotencyHash}-${d.rowNumber}`} className="text-xs">
                      <TableCell className="text-zinc-500 font-mono">{d.rowNumber}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(d.tradeDate)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          {TRANSACTION_TYPE_LABELS[d.type]}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono font-medium text-zinc-200">{d.ticker ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono">
                        {formatAmount(d.netAmount)} {d.currencyCode}
                      </TableCell>
                      <TableCell className="text-zinc-500">
                        {formatDateTime(d.existing.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
