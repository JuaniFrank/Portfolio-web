"use client";

import { useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  Sparkles,
  Wallet,
  TrendingDown,
  CheckCircle2,
  Sliders,
  History,
  Eye,
  ChevronRight,
  Info,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AUTO_CLEAR_CATEGORIES,
  type AutoClearReason,
  type AutoClearSummary,
} from "@/lib/importers/auto-clear";
import type { NormalizedImportRow } from "@/lib/importers/types";
import { TRANSACTION_TYPE_LABELS } from "@/lib/imports/filters";
import { cn } from "@/lib/utils";

type AutoClearCardProps = {
  summary: AutoClearSummary;
  rows: NormalizedImportRow[];
  activeCategories: Set<AutoClearReason>;
  onToggleCategory: (reason: AutoClearReason) => void;
  onSelectAllCategories: () => void;
  onClearAllCategories: () => void;
  onContinue: () => void;
  onBack: () => void;
};

const CATEGORY_ICONS: Record<AutoClearReason, typeof Wallet> = {
  cash_movement: Wallet,
  unsupported_instrument: TrendingDown,
  amortized_ticker: History,
  adjustment: Sliders,
};

function formatAmount(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string) {
  try {
    return format(new Date(iso), "dd/MM/yyyy", { locale: es });
  } catch {
    return iso;
  }
}

export function AutoClearCard({
  summary,
  rows,
  activeCategories,
  onToggleCategory,
  onSelectAllCategories,
  onClearAllCategories,
  onContinue,
  onBack,
}: AutoClearCardProps) {
  const [inspectCategory, setInspectCategory] = useState<AutoClearReason | null>(null);

  // Calcula cuántas filas se van a excluir actualmente según los toggles activos
  const currentExcludedCount = Array.from(activeCategories).reduce(
    (acc, reason) => acc + (summary.counts[reason] ?? 0),
    0
  );
  const remainingCount = Math.max(0, rows.length - currentExcludedCount);

  // Filas para el diálogo de inspección
  const inspectRows = inspectCategory
    ? rows.filter((r) => summary.byCategory[inspectCategory]?.includes(r.rowNumber))
    : [];

  const inspectMeta = inspectCategory ? AUTO_CLEAR_CATEGORIES[inspectCategory] : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Encabezado */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-teal-500/10 text-teal-400">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
            Paso 2: Curaduría y Auto-Clear Inteligente
          </h2>
        </div>
        <p className="text-sm text-zinc-400">
          Revisá qué operaciones conviene excluir por defecto. Omitir estos movimientos evita
          ensuciar los rendimientos con transferencias de dinero o activos sin cotización histórica.
        </p>
      </div>

      {/* Resumen de Estado */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-teal-900/40 bg-teal-950/20 px-4 py-3 text-xs">
        <div className="flex items-center gap-2 text-teal-300">
          <CheckCircle2 className="h-4 w-4 text-teal-400" />
          <span>
            Se excluirán <strong className="text-zinc-100">{currentExcludedCount}</strong> de{" "}
            <strong className="text-zinc-100">{rows.length}</strong> movimientos (quedan{" "}
            <strong className="text-teal-400">{remainingCount}</strong> para importar)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSelectAllCategories}
            className="text-teal-400 hover:text-teal-300 underline underline-offset-2"
          >
            Activar todas
          </button>
          <span className="text-zinc-600">·</span>
          <button
            type="button"
            onClick={onClearAllCategories}
            className="text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
          >
            Desactivar todas
          </button>
        </div>
      </div>

      {/* Tarjetas de Categorías */}
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(AUTO_CLEAR_CATEGORIES) as AutoClearReason[]).map((reason) => {
          const meta = AUTO_CLEAR_CATEGORIES[reason];
          const count = summary.counts[reason] ?? 0;
          const isActive = activeCategories.has(reason);
          const Icon = CATEGORY_ICONS[reason] ?? Sparkles;

          return (
            <div
              key={reason}
              className={cn(
                "relative flex flex-col justify-between rounded-lg border p-4 transition-colors",
                isActive
                  ? "border-teal-500/40 bg-teal-950/10"
                  : "border-zinc-800/80 bg-zinc-950/40 opacity-70",
                count === 0 && "opacity-40"
              )}
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-lg border text-zinc-300",
                        isActive
                          ? "border-teal-500/30 bg-teal-500/10 text-teal-400"
                          : "border-zinc-800 bg-zinc-900 text-zinc-500"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-zinc-200">{meta.title}</h3>
                      <Badge
                        variant={count > 0 ? (isActive ? "default" : "secondary") : "outline"}
                        className="mt-0.5 text-[10px]"
                      >
                        {count} {count === 1 ? "fila" : "filas"}
                      </Badge>
                    </div>
                  </div>

                  {/* Interruptor Switch Accesible */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isActive}
                    disabled={count === 0}
                    onClick={() => onToggleCategory(reason)}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
                      isActive ? "bg-teal-500" : "bg-zinc-800",
                      count === 0 && "cursor-not-allowed opacity-40"
                    )}
                  >
                    <span
                      className={cn(
                        "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform",
                        isActive ? "translate-x-4" : "translate-x-0"
                      )}
                    />
                  </button>
                </div>

                <p className="text-xs leading-relaxed text-zinc-400">{meta.description}</p>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-zinc-800/60 pt-3">
                <span className="text-[11px] text-zinc-500">
                  {isActive ? "Se excluirán del import" : "Se incluirán en el import"}
                </span>

                {count > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-zinc-400 hover:text-zinc-100"
                    onClick={() => setInspectCategory(reason)}
                  >
                    <Eye className="mr-1.5 h-3 w-3" />
                    Ver filas ({count})
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Botones de Navegación del Wizard */}
      <div className="flex items-center justify-between border-t border-zinc-800/80 pt-4">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Cambiar archivo
        </Button>

        <Button type="button" onClick={onContinue} className="gap-2">
          Continuar a la revisión
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Diálogo para Inspeccionar Filas de la Categoría */}
      <Dialog open={inspectCategory !== null} onOpenChange={(o) => !o && setInspectCategory(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4 text-teal-400" />
              Filas detectadas: {inspectMeta?.title}
            </DialogTitle>
            <DialogDescription className="text-xs text-zinc-400">
              {inspectMeta?.description}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-80 overflow-auto rounded-md border border-zinc-800">
            <Table>
              <TableHeader className="sticky top-0 bg-zinc-950">
                <TableRow>
                  <TableHead className="w-10 text-xs">#</TableHead>
                  <TableHead className="text-xs">Fecha</TableHead>
                  <TableHead className="text-xs">Tipo</TableHead>
                  <TableHead className="text-xs">Ticker</TableHead>
                  <TableHead className="text-right text-xs">Importe</TableHead>
                  <TableHead className="text-xs">Descripción original</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inspectRows.map((row) => (
                  <TableRow key={row.rowNumber} className="text-xs">
                    <TableCell className="text-zinc-500 font-mono">{row.rowNumber}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.parsed ? formatDate(row.parsed.tradeDate) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-normal">
                        {row.parsed ? TRANSACTION_TYPE_LABELS[row.parsed.type] : "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono font-medium text-zinc-200">
                      {row.parsed?.ticker ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.parsed ? `${formatAmount(row.parsed.netAmount)} ${row.parsed.currencyCode}` : "—"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-zinc-500" title={row.raw.Descripcion}>
                      {row.raw.Descripcion}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => setInspectCategory(null)}>
              Cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
