"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TickerAvatar } from "@/components/transactions/ticker-avatar";
import type { HoldingRow } from "@/lib/transactions/types";
import { cn } from "@/lib/utils";

function formatMoney(value: string) {
  const n = Number(value);
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}

function formatQty(value: string) {
  const n = Number(value);
  return n.toLocaleString("es-AR", { maximumFractionDigits: 4 });
}

type HoldingsTableProps = {
  holdings: HoldingRow[];
  search: string;
};

export function HoldingsTable({ holdings, search }: HoldingsTableProps) {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? holdings.filter(
        (h) => h.ticker.toLowerCase().includes(q) || h.instrumentName.toLowerCase().includes(q)
      )
    : holdings;

  if (holdings.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="overflow-auto rounded-lg border border-zinc-800">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Ticker</TableHead>
            <TableHead className="text-right">Cantidad</TableHead>
            <TableHead className="text-right">Precio promedio</TableHead>
            <TableHead className="text-right">Monto</TableHead>
            <TableHead className="text-right">Precio actual</TableHead>
            <TableHead className="text-right">Rendimiento</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-sm text-zinc-500">
                Ningún ticker coincide con la búsqueda.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((row) => <HoldingRow key={row.instrumentId} row={row} />)
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-12 text-center">
      <p className="text-sm text-zinc-400">No tenés posiciones en acciones, CEDEARs u ONs.</p>
      <p className="mt-1 text-xs text-zinc-500">
        Importá movimientos desde Balanz o registrá operaciones manualmente.
      </p>
    </div>
  );
}

function HoldingRow({ row }: { row: HoldingRow }) {
  const pnl = Number(row.pnlArs);
  const pnlPct = Number(row.pnlPercent);
  const positive = pnl >= 0;

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <TickerAvatar ticker={row.ticker} className="h-10 w-10" />
          <div>
            <p className="font-semibold text-zinc-100 ">{row.ticker}</p>
            <p className="text-sm text-zinc-500">{row.instrumentName}</p>{" "}
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-sm">{formatQty(row.quantity)}</TableCell>
      <TableCell className="text-right font-mono text-sm text-zinc-300">
        {formatMoney(row.avgPriceArs)}
      </TableCell>
      <TableCell className="text-right font-mono text-sm text-zinc-200">
        {formatMoney(row.costBasisArs)}
      </TableCell>
      <TableCell className="text-right font-mono text-sm text-zinc-300">
        {formatMoney(row.currentPriceArs)}
      </TableCell>
      <TableCell className="text-right">
        <span className={cn("font-mono text-sm", positive ? "text-emerald-400" : "text-red-400")}>
          {formatMoney(row.pnlArs)} ({positive ? "+" : ""}
          {pnlPct.toLocaleString("es-AR", { maximumFractionDigits: 2 })}%)
        </span>
      </TableCell>
    </TableRow>
  );
}
