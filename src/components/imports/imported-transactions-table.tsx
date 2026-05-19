"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
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

export function ImportedTransactionsTable({ transactions }: ImportedTransactionsTableProps) {
  const [filter, setFilter] = useState<ImportTransactionFilter>("all");

  const filtered = useMemo(
    () => transactions.filter((row) => matchesImportFilter(row, filter)),
    [transactions, filter]
  );

  const counts = useMemo(() => {
    const map = new Map<ImportTransactionFilter, number>();
    for (const f of IMPORT_TRANSACTION_FILTERS) {
      map.set(
        f.id,
        f.id === "all"
          ? transactions.length
          : transactions.filter((r) => matchesImportFilter(r, f.id)).length
      );
    }
    return map;
  }, [transactions]);

  if (transactions.length === 0) {
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
    <ImportedTransactionsTableInner
      filter={filter}
      setFilter={setFilter}
      filtered={filtered}
      counts={counts}
    />
  );
}

function ImportedTransactionsTableInner({
  filter,
  setFilter,
  filtered,
  counts,
}: {
  filter: ImportTransactionFilter;
  setFilter: (f: ImportTransactionFilter) => void;
  filtered: ImportedTransactionRow[];
  counts: Map<ImportTransactionFilter, number>;
}) {
  return (
    <div className="space-y-4">
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

      <p className="text-sm text-zinc-500">
        Mostrando {filtered.length} de {counts.get("all") ?? 0} movimientos importados
      </p>

      <div className="overflow-auto rounded-md border border-zinc-800">
        <Table>
          <TableHeader>
            <TableRow>
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
                <TableCell colSpan={8} className="py-8 text-center text-sm text-zinc-500">
                  No hay movimientos para este filtro.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => <TransactionRow key={row.id} row={row} />)
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function TransactionRow({ row }: { row: ImportedTransactionRow }) {
  const amount = Number(row.netAmount);
  const categoryLabel = row.instrumentType
    ? (INSTRUMENT_TYPE_LABELS[row.instrumentType] ?? row.instrumentType)
    : "—";

  return (
    <TableRow>
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
