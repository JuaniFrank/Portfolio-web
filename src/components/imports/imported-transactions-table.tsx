"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Trash2, X } from "lucide-react";
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
import { DeleteTransactionsDialog } from "@/components/imports/delete-transactions-dialog";
import {
  IMPORT_TRANSACTION_FILTERS,
  INSTRUMENT_TYPE_LABELS,
  TRANSACTION_TYPE_LABELS,
  matchesImportFilter,
  type ImportTransactionFilter,
  type ImportedTransactionRow,
} from "@/lib/imports/filters";
import { cn } from "@/lib/utils";

type ImportedTransactionsTableProps = {
  transactions: ImportedTransactionRow[];
};

function formatDate(iso: string) {
  return format(new Date(iso), "dd/MM/yyyy", { locale: es });
}

function formatAmount(value: string) {
  const n = Number(value);
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatQuantity(value: string) {
  const n = Number(value);
  if (n === 0) return "—";
  return n.toLocaleString("es-AR", { maximumFractionDigits: 4 });
}

/** Línea corta que describe una operación, para el diálogo de confirmación. */
function describeRow(row: ImportedTransactionRow): string {
  return [
    formatDate(row.tradeDate),
    TRANSACTION_TYPE_LABELS[row.type],
    row.ticker ?? "—",
    `${formatAmount(row.netAmount)} ${row.currencyCode}`,
  ].join(" · ");
}

export function ImportedTransactionsTable({ transactions }: ImportedTransactionsTableProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<ImportTransactionFilter>("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);

  // Las filas borradas se ocultan de inmediato; `router.refresh()` después trae
  // la lista real desde el servidor.
  const liveTransactions = useMemo(
    () => transactions.filter((t) => !removedIds.has(t.id)),
    [transactions, removedIds]
  );

  const filtered = useMemo(
    () => liveTransactions.filter((row) => matchesImportFilter(row, filter)),
    [liveTransactions, filter]
  );

  const counts = useMemo(() => {
    const map = new Map<ImportTransactionFilter, number>();
    for (const f of IMPORT_TRANSACTION_FILTERS) {
      map.set(
        f.id,
        f.id === "all"
          ? liveTransactions.length
          : liveTransactions.filter((r) => matchesImportFilter(r, f.id)).length
      );
    }
    return map;
  }, [liveTransactions]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  const selectedRows = useMemo(
    () => liveTransactions.filter((t) => selected.has(t.id)),
    [liveTransactions, selected]
  );

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const r of filtered) next.delete(r.id);
      } else {
        for (const r of filtered) next.add(r.id);
      }
      return next;
    });
  }

  function handleDeleted(ids: string[]) {
    setRemovedIds((prev) => new Set([...prev, ...ids]));
    setSelected(new Set());
    router.refresh();
  }

  if (liveTransactions.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-12 text-center">
        <p className="text-sm text-zinc-400">Todavía no importaste movimientos.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Usá &quot;Nuevo import&quot; para subir un archivo .xlsx de Balanz.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {IMPORT_TRANSACTION_FILTERS.map((f) => {
          const count = counts.get(f.id) ?? 0;
          const active = filter === f.id;
          return (
            <Button
              key={f.id}
              type="button"
              size="sm"
              variant={active ? "default" : "outline"}
              className={cn("h-8", !active && count === 0 && "opacity-50")}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className="ml-1.5 text-xs opacity-70">({count})</span>
            </Button>
          );
        })}
      </div>

      {/* Barra de acciones sobre la selección */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-teal-900/60 bg-teal-950/20 px-4 py-2.5">
          <p className="text-sm text-teal-100">
            <span className="font-semibold">{selected.size}</span>{" "}
            {selected.size === 1 ? "operación seleccionada" : "operaciones seleccionadas"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-zinc-300"
              onClick={() => setSelected(new Set())}
            >
              <X className="mr-1.5 h-3.5 w-3.5" />
              Limpiar
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-8"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Borrar seleccionadas
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-zinc-500">
          Mostrando {filtered.length} de {counts.get("all") ?? 0} movimientos importados
        </p>
      )}

      <div className="overflow-auto rounded-md border border-zinc-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-teal-500"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  disabled={filtered.length === 0}
                  aria-label={
                    allVisibleSelected
                      ? "Deseleccionar todas las visibles"
                      : "Seleccionar todas las visibles"
                  }
                />
              </TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Ticker</TableHead>
              <TableHead className="text-right">Cant.</TableHead>
              <TableHead className="text-right">Importe</TableHead>
              <TableHead>Mon.</TableHead>
              <TableHead>Broker</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-zinc-500">
                  No hay movimientos para este filtro.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TransactionRow
                  key={row.id}
                  row={row}
                  isSelected={selected.has(row.id)}
                  onToggle={() => toggleRow(row.id)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DeleteTransactionsDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        ids={selectedRows.map((r) => r.id)}
        preview={selectedRows.map(describeRow)}
        onDeleted={handleDeleted}
      />
    </div>
  );
}

function TransactionRow({
  row,
  isSelected,
  onToggle,
}: {
  row: ImportedTransactionRow;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const amount = Number(row.netAmount);
  const categoryLabel = row.instrumentType
    ? (INSTRUMENT_TYPE_LABELS[row.instrumentType] ?? row.instrumentType)
    : "—";

  return (
    <TableRow className={cn(isSelected && "bg-teal-950/20")}>
      <TableCell>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-teal-500"
          checked={isSelected}
          onChange={onToggle}
          aria-label={`Seleccionar operación del ${formatDate(row.tradeDate)}`}
        />
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs">{formatDate(row.tradeDate)}</TableCell>
      <TableCell>
        <Badge variant="secondary" className="font-normal">
          {TRANSACTION_TYPE_LABELS[row.type]}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-zinc-400">{categoryLabel}</TableCell>
      <TableCell className="font-mono text-xs">{row.ticker ?? "—"}</TableCell>
      <TableCell className="text-right font-mono text-xs">{formatQuantity(row.quantity)}</TableCell>
      <TableCell
        className={cn(
          "text-right font-mono text-xs",
          amount > 0 && "text-emerald-400",
          amount < 0 && "text-red-400"
        )}
      >
        {formatAmount(row.netAmount)}
      </TableCell>
      <TableCell className="text-xs">{row.currencyCode}</TableCell>
      <TableCell className="max-w-[100px] truncate text-xs text-zinc-500" title={row.brokerName}>
        {row.brokerName}
      </TableCell>
    </TableRow>
  );
}
