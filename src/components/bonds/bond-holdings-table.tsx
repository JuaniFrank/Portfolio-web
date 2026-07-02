"use client";

import { AlertCircle, Clock } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TickerAvatar } from "@/components/transactions/ticker-avatar";
import type { BondHolding, BondHoldingV2 } from "@/lib/bonds/types";
import { cn } from "@/lib/utils";
import { formatMoney, formatNumber, formatPercent } from "./format";

type Props = {
  /** Accepts both v1 BondHolding and v2 BondHoldingV2 (superset). */
  holdings: (BondHolding | BondHoldingV2)[];
};

export function BondHoldingsTable({ holdings }: Props) {
  if (holdings.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center">
        <p className="text-sm text-zinc-400">No hay posiciones en bonos corporativos (ONs).</p>
        <p className="mt-1 text-xs text-zinc-500">
          Importá movimientos de ONs desde Balanz para verlas acá.
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
            <TableHead className="text-right">Nominal</TableHead>
            <TableHead className="text-right">Último precio</TableHead>
            <TableHead className="text-right">Val. mercado USD</TableHead>
            <TableHead className="text-right">Costo USD</TableHead>
            <TableHead className="text-right">P&amp;L no realizado</TableHead>
            <TableHead className="text-right">% cambio</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {holdings.map((h) => {
            const pnlNum = h.unrealizedPnlUsd !== null ? Number(h.unrealizedPnlUsd) : null;
            const pnlPositive = pnlNum !== null && pnlNum >= 0;

            return (
              <TableRow key={h.ticker}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <TickerAvatar ticker={h.ticker} />
                    <div>
                      <p className="font-semibold text-zinc-100">{h.ticker}</p>
                      {h.priceStale ? (
                        <div className="mt-0.5 flex items-center gap-1 text-amber-400">
                          <Clock className="h-3 w-3" />
                          <span className="text-xs">precio cacheado</span>
                        </div>
                      ) : h.priceUnavailable ? (
                        <div className="mt-0.5 flex items-center gap-1 text-zinc-500">
                          <AlertCircle className="h-3 w-3" />
                          <span className="text-xs">precio no disponible</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-zinc-300">
                  {formatNumber(h.nominalHeld, 4)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-zinc-300">
                  {h.priceUnavailable ? (
                    <span className="text-zinc-600">—</span>
                  ) : (
                    <PriceCell holding={h} />
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-zinc-200">
                  {h.priceUnavailable ? (
                    <span className="text-zinc-600">—</span>
                  ) : (
                    formatMoney(h.marketValueUsd, "USD")
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-zinc-300">
                  {formatMoney(h.costBasisUsd, "USD")}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-sm font-semibold",
                    pnlNum === null
                      ? "text-zinc-600"
                      : pnlPositive
                        ? "text-emerald-400"
                        : "text-rose-400"
                  )}
                >
                  {formatMoney(h.unrealizedPnlUsd, "USD")}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-sm",
                    h.pctChange === null
                      ? "text-zinc-600"
                      : Number(h.pctChange) >= 0
                        ? "text-emerald-400"
                        : "text-rose-400"
                  )}
                >
                  {formatPercent(h.pctChange)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Display the last price directly from the data912 `c` field (ARS per 100 VN).
 * Previously back-calculated from marketValueArs / nominalHeld; now uses the
 * directly carried lastPriceArs field added in v2 to avoid the back-calculation.
 */
function PriceCell({ holding }: { holding: BondHolding }) {
  if (holding.lastPriceArs === null) {
    return <span className="text-zinc-600">—</span>;
  }
  const price = Number(holding.lastPriceArs);
  if (!Number.isFinite(price)) return <span className="text-zinc-600">—</span>;
  return (
    <span>
      {price.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
      <span className="ml-1 text-xs text-zinc-500">ARS/100VN</span>
    </span>
  );
}
