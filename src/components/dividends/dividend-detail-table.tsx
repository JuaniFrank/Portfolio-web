"use client";

import { useMemo, useState } from "react";
import { Info, Search } from "lucide-react";
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
  cclToday,
}: {
  rows: DividendByTicker[];
  currency: ViewCurrency;
  cclToday?: string | null;
}) {
  const ccl = cclToday ? Number(cclToday) : 0;

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
            const hasUsdGross = Number(row.grossUsd) > 0;
            const hasArsGross = Number(row.grossArs) > 0;
            const hasUsdNet = Number(row.netUsd) > 0;
            const hasArsNet = Number(row.netArs) > 0;
            const hasArsTax = Number(row.taxArs) > 0;
            const hasUsdTax = Number(row.taxUsd) > 0;

            const estGrossArs = hasUsdGross && ccl > 0
              ? Number(row.grossUsd) * ccl + (hasArsGross ? Number(row.grossArs) : 0)
              : null;

            const estNetArs = hasUsdNet && ccl > 0
              ? Number(row.netUsd) * ccl + (hasArsNet ? Number(row.netArs) : 0)
              : null;

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
                  {hasUsdGross ? (
                    <div className="flex flex-col items-end">
                      <span>{formatMoney(row.grossUsd, "USD")}</span>
                      {estGrossArs !== null ? (
                        <span
                          title="El precio es un estimado entre el cobro del dividendo × el CCL del día de hoy."
                          className="inline-flex cursor-help items-center gap-1 text-xs text-zinc-400 hover:text-zinc-300"
                        >
                          <span>≈ {formatMoney(estGrossArs, "ARS")}</span>
                          <Info className="h-3 w-3 shrink-0 text-zinc-500" />
                        </span>
                      ) : null}
                    </div>
                  ) : hasArsGross ? (
                    formatMoney(row.grossArs, "ARS")
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-rose-300">
                  {hasArsTax
                    ? formatMoney(row.taxArs, "ARS")
                    : hasUsdTax
                      ? formatMoney(row.taxUsd, "USD")
                      : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-semibold text-emerald-400">
                  {hasUsdNet ? (
                    <div className="flex flex-col items-end">
                      <span>{formatMoney(row.netUsd, "USD")}</span>
                      {estNetArs !== null ? (
                        <span
                          title="El precio es un estimado entre el cobro del dividendo × el CCL del día de hoy."
                          className="inline-flex cursor-help items-center gap-1 text-xs font-normal text-zinc-400 hover:text-zinc-300"
                        >
                          <span>≈ {formatMoney(estNetArs, "ARS")}</span>
                          <Info className="h-3 w-3 shrink-0 text-zinc-500" />
                        </span>
                      ) : null}
                    </div>
                  ) : hasArsNet ? (
                    formatMoney(row.netArs, "ARS")
                  ) : (
                    "—"
                  )}
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
