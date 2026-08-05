"use client";

import { format } from "date-fns";
import { es } from "date-fns/locale";
import { AlertTriangle, FileWarning } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: DuplicateCheckResult | null;
  /** El usuario eligió cómo seguir. */
  onConfirm: (strategy: DuplicateStrategy) => void;
  pending?: boolean;
};

function formatDate(iso: string) {
  return format(new Date(iso), "dd/MM/yyyy", { locale: es });
}

function formatDateTime(iso: string) {
  return format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: es });
}

function formatAmount(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Aviso de duplicados previo al commit.
 *
 * Muestra dos señales independientes: que el archivo completo ya se importó
 * (mismo `fileHash`) y qué filas puntuales ya existen en la base (mismo
 * `idempotencyHash`). La decisión es del usuario — no hay un default silencioso.
 */
export function ImportDuplicatesDialog({
  open,
  onOpenChange,
  result,
  onConfirm,
  pending,
}: Props) {
  if (!result) return null;

  const { sameFileBatches, duplicateRows, freshCount, totalCount } = result;
  const duplicateCount = duplicateRows.length;
  const allDuplicated = duplicateCount > 0 && freshCount === 0;

  return (
    <Dialog open={open} onOpenChange={pending ? () => {} : onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Detectamos movimientos ya importados
          </DialogTitle>
          <DialogDescription>
            Antes de guardar, revisá qué se está repitiendo. Podés omitir los duplicados o
            importarlos igual.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Señal 1: el archivo completo ya pasó por acá */}
          {sameFileBatches.length > 0 && (
            <div className="rounded-md border border-amber-900/50 bg-amber-950/20 p-3">
              <div className="flex items-start gap-3">
                <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div className="space-y-2 text-xs text-amber-100">
                  <p className="font-medium text-amber-200">
                    Este archivo exacto ya se importó{" "}
                    {sameFileBatches.length === 1
                      ? "una vez"
                      : `${sameFileBatches.length} veces`}
                    .
                  </p>
                  <ul className="space-y-1">
                    {sameFileBatches.map((b) => (
                      <li key={b.importBatchId} className="text-amber-100/80">
                        · <span className="font-mono">{b.fileName}</span> — {b.brokerName} ·{" "}
                        {formatDateTime(b.committedAt ?? b.createdAt)} · {b.rowsImported}{" "}
                        movimientos
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Resumen numérico */}
          <div className="grid grid-cols-3 gap-3">
            <SummaryTile label="Filas del archivo" value={totalCount} />
            <SummaryTile label="Nuevas" value={freshCount} tone="emerald" />
            <SummaryTile label="Ya existentes" value={duplicateCount} tone="amber" />
          </div>

          {/* Señal 2: detalle fila por fila */}
          {duplicateCount > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">
                Estas filas coinciden exactamente con operaciones que ya están en tu cartera
                (mismo instrumento, fecha, cantidad e importe):
              </p>
              <div className="max-h-64 overflow-auto rounded-md border border-zinc-800">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-zinc-950">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Ticker</TableHead>
                      <TableHead className="text-right">Cant.</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                      <TableHead>Ya importada</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {duplicateRows.map((d) => (
                      <TableRow key={`${d.idempotencyHash}-${d.rowNumber}`}>
                        <TableCell className="text-xs text-zinc-500">{d.rowNumber}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {formatDate(d.tradeDate)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant="secondary" className="font-normal">
                            {TRANSACTION_TYPE_LABELS[d.type]}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{d.ticker ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {d.quantity}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {formatAmount(d.netAmount)} {d.currencyCode}
                        </TableCell>
                        <TableCell className="text-xs text-zinc-500">
                          {formatDateTime(d.existing.createdAt)}
                          {d.existing.fileName && (
                            <span
                              className="block max-w-[160px] truncate text-[10px] text-zinc-600"
                              title={d.existing.fileName}
                            >
                              {d.existing.fileName}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {allDuplicated && (
            <p className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
              Todas las filas de este archivo ya están importadas. Si omitís los duplicados no se
              va a guardar nada nuevo.
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Volver
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onConfirm("import")}
            disabled={pending}
            title="Inserta también las filas repetidas, como movimientos adicionales"
          >
            Importar igual ({totalCount})
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm("skip")}
            disabled={pending || freshCount === 0}
          >
            Omitir duplicados e importar {freshCount}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "emerald" | "amber";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-400"
      : tone === "amber"
        ? "text-amber-400"
        : "text-zinc-100";

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}
