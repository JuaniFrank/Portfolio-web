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
import type { ReceivedFlow } from "@/lib/bonds/types";
import { cn } from "@/lib/utils";
import { formatFullDate, formatMoney } from "./format";

type Props = {
  flows: ReceivedFlow[];
};

const TYPE_LABEL: Record<"COUPON" | "AMORTIZATION", string> = {
  COUPON: "Cupón",
  AMORTIZATION: "Amortización",
};

const TYPE_COLOR: Record<"COUPON" | "AMORTIZATION", string> = {
  COUPON: "text-emerald-400",
  AMORTIZATION: "text-sky-400",
};

export function BondCashflowTable({ flows }: Props) {
  if (flows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-10 text-center">
        <p className="text-sm text-zinc-400">Todavía no recibiste cupones ni amortizaciones.</p>
        <p className="mt-1 text-xs text-zinc-500">
          Importá movimientos desde Balanz para ver el historial de flujos.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border border-zinc-800">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Fecha</TableHead>
            <TableHead>Ticker</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead className="text-right">Importe</TableHead>
            <TableHead className="text-right">Moneda</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {flows.map((flow, i) => (
            <TableRow key={`${flow.ticker}-${flow.type}-${flow.date}-${i}`}>
              <TableCell className="text-sm text-zinc-300">
                {formatFullDate(flow.date)}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <TickerAvatar ticker={flow.ticker} />
                  <span className="font-semibold text-zinc-100">{flow.ticker}</span>
                </div>
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    "rounded-sm px-1.5 py-0.5 text-xs font-medium",
                    flow.type === "COUPON"
                      ? "bg-emerald-950/40 text-emerald-400"
                      : "bg-sky-950/40 text-sky-400"
                  )}
                >
                  {TYPE_LABEL[flow.type]}
                </span>
              </TableCell>
              <TableCell className={cn("text-right font-mono text-sm font-semibold", TYPE_COLOR[flow.type])}>
                {flow.currencyCode === "USD"
                  ? formatMoney(flow.amount, "USD")
                  : formatMoney(flow.amount, "ARS")}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-zinc-500">
                {flow.currencyCode}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
