"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TickerAvatar } from "@/components/transactions/ticker-avatar";
import type { DividendByTicker, ReceivedDividend } from "@/lib/dividends/types";
import { formatFullDate, formatMoney, type ViewCurrency } from "./format";

export function DividendByTickerTable({
  rows,
  currency,
}: {
  rows: DividendByTicker[];
  currency: ViewCurrency;
}) {
  const isArs = currency === "ARS";

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center">
        <p className="text-sm text-zinc-400">Todavía no recibiste dividendos.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Importá movimientos desde Balanz para empezar a verlos acá.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border border-zinc-800">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Ticker</TableHead>
            <TableHead className="text-right">Pagos</TableHead>
            <TableHead className="text-right">Bruto</TableHead>
            <TableHead className="text-right">Retenciones</TableHead>
            <TableHead className="text-right">Neto</TableHead>
            <TableHead className="text-right">Cantidad actual</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const gross = isArs ? row.grossArs : row.grossUsd;
            const tax = isArs ? row.taxArs : row.taxUsd;
            const net = isArs ? row.netArs : row.netUsd;
            return (
              <TableRow key={row.ticker}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <TickerAvatar ticker={row.ticker} />
                    <div>
                      <p className="font-semibold text-zinc-100">{row.ticker}</p>
                      {row.instrumentName ? (
                        <p className="text-xs text-zinc-500">{row.instrumentName}</p>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-zinc-300">
                  {row.payments}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-zinc-200">
                  {formatMoney(gross, currency)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-rose-300">
                  {formatMoney(tax, currency)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-semibold text-emerald-400">
                  {formatMoney(net, currency)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-zinc-300">
                  {row.currentQuantity}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function DividendHistoryTable({
  rows,
}: {
  rows: ReceivedDividend[];
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (r) =>
        r.ticker.toLowerCase().includes(term) ||
        (r.instrumentName ?? "").toLowerCase().includes(term)
    );
  }, [rows, q]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center">
        <p className="text-sm text-zinc-400">No hay pagos para mostrar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <Input
          placeholder="Buscar por ticker o nombre…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="overflow-auto rounded-lg border border-zinc-800">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Fecha</TableHead>
              <TableHead>Ticker</TableHead>
              <TableHead className="text-right">Cobrado USD</TableHead>
              <TableHead className="text-right">Cobrado ARS</TableHead>
              <TableHead className="text-right">Impuesto ARS</TableHead>
              <TableHead className="text-right">Neto ARS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-zinc-500">
                  Ningún dividendo coincide con la búsqueda.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => {
                const isCedear = Number(r.grossUsd) > 0;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm text-zinc-300">
                      {formatFullDate(r.tradeDate)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <TickerAvatar ticker={r.ticker} />
                        <span className="font-semibold text-zinc-100">{r.ticker}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-zinc-200">
                      {isCedear ? formatMoney(r.grossUsd, "USD") : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-zinc-200">
                      {isCedear ? "—" : formatMoney(r.grossArs, "ARS")}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-rose-300">
                      {Number(r.taxArs) > 0 ? formatMoney(r.taxArs, "ARS") : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold text-emerald-400">
                      {isCedear ? "—" : formatMoney(r.netArs, "ARS")}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
