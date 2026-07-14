"use client";

import { format } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
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
import { TickerAvatar } from "@/components/transactions/ticker-avatar";
import { TRANSACTION_TYPE_LABELS } from "@/lib/imports/filters";
import type { TradeHistoryRow } from "@/lib/transactions/types";
import { cn } from "@/lib/utils";

function formatDate(iso: string) {
  return format(new Date(iso), "yyyy-MM-dd");
}

function formatMoneyArs(value: string) {
  const n = Number(value);
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function formatMoneyUsd(value: string | null) {
  if (!value) return "—";
  const n = Number(value);
  return (
    n.toLocaleString("es-AR", { style: "currency", currency: "USD", currencyDisplay: "code" }) +
    " USD"
  );
}

function formatQty(value: string) {
  const n = Number(value);
  return n.toLocaleString("es-AR", { maximumFractionDigits: 4 });
}

type TradeHistoryTableProps = {
  trades: TradeHistoryRow[];
  search: string;
};

export function TradeHistoryTable({ trades, search }: TradeHistoryTableProps) {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? trades.filter(
        (t) =>
          t.ticker.toLowerCase().includes(q) ||
          t.instrumentName.toLowerCase().includes(q) ||
          t.amountArs.includes(q) ||
          (t.tagLabel?.toLowerCase().includes(q) ?? false) ||
          TRANSACTION_TYPE_LABELS[t.type].toLowerCase().includes(q)
      )
    : trades;

  if (trades.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-12 text-center">
        <p className="text-sm text-zinc-400">No hay operaciones de compra o venta registradas.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Las operaciones de acciones, CEDEARs y ONs aparecerán acá.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border border-zinc-800">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10" />
            <TableHead>Ticker</TableHead>
            <TableHead>Fecha</TableHead>
            <TableHead className="text-right">Cantidad</TableHead>
            <TableHead className="text-right">Precio ARS</TableHead>
            <TableHead className="text-right">Precio USD</TableHead>
            <TableHead className="text-right">Monto</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Etiquetas</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={10} className="py-8 text-center text-sm text-zinc-500">
                Ninguna operación coincide con la búsqueda.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((row) => <TradeRow key={row.id} row={row} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function TradeRow({ row }: { row: TradeHistoryRow }) {
  return (
    <TableRow>
      <TableCell>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-zinc-700 bg-zinc-900"
          aria-label={`Seleccionar ${row.ticker}`}
        />
      </TableCell>
      <TableCell>
        <TickerCell ticker={row.ticker} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-sm text-zinc-300">
        {formatDate(row.tradeDate)}
      </TableCell>
      <TableCell className="text-right font-mono text-sm">{formatQty(row.quantity)}</TableCell>
      <TableCell className="text-right font-mono text-sm">{formatMoneyArs(row.priceArs)}</TableCell>
      <TableCell className="text-right font-mono text-sm text-zinc-400">
        {formatMoneyUsd(row.priceUsd)}
      </TableCell>
      <TableCell className="text-right font-mono text-sm text-zinc-200">
        {formatMoneyArs(row.amountArs)}
      </TableCell>
      <TableCell className="text-sm">{TRANSACTION_TYPE_LABELS[row.type]}</TableCell>
      <TableCell>
        {row.tagLabel ? (
          <Badge variant="default" className="bg-blue-600/20 text-blue-300 hover:bg-blue-600/30">
            {row.tagLabel}
          </Badge>
        ) : (
          <span className="text-xs text-zinc-500">Sin etiquetas</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-400 hover:text-zinc-100"
            disabled
            title="Editar (próximamente)"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-red-400/80 hover:text-red-400"
            disabled
            title="Eliminar (próximamente)"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function TickerCell({ ticker }: { ticker: string }) {
  return (
    <div className="flex items-center gap-3">
      <TickerAvatar ticker={ticker} />
      <span className="font-semibold text-zinc-100">{ticker}</span>
    </div>
  );
}
