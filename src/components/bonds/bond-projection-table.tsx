"use client";

import { InfoIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { UpcomingFlow } from "@/lib/bonds/types";
import { formatFullDate, formatMoney, type ViewCurrency } from "./format";

type Props = {
  flows: UpcomingFlow[];
  /** Must be "USD" or "ARS" to match ViewCurrency. */
  currencyCode: ViewCurrency;
  ticker: string;
  hasTerms: boolean;
  onEnterTerms?: () => void;
};

export function BondProjectionTable({
  flows,
  currencyCode,
  ticker,
  hasTerms,
  onEnterTerms,
}: Props) {
  if (!hasTerms) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-8 text-center">
        <p className="text-sm text-zinc-400">No hay términos cargados para {ticker}.</p>
        <p className="mt-1 text-xs text-zinc-500">
          {onEnterTerms ? (
            <>
              <button
                onClick={onEnterTerms}
                className="text-teal-400 underline underline-offset-2 hover:text-teal-300"
              >
                Cargar términos
              </button>{" "}
              para proyectar los pagos futuros de cupón y amortización.
            </>
          ) : (
            "Cargá los términos para proyectar los pagos futuros de cupón y amortización."
          )}
        </p>
      </div>
    );
  }

  if (flows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-8 text-center">
        <p className="text-sm text-zinc-400">
          No hay flujos futuros — el bono puede haber vencido o todos los flujos ya ocurrieron.
        </p>
      </div>
    );
  }

  const hasAssumedRate = flows.some((f) => f.assumedRate);

  return (
    <div className="space-y-2">
      {hasAssumedRate && (
        <div className="flex items-start gap-2 rounded-md border border-amber-900/50 bg-amber-950/20 p-2 text-xs text-amber-200">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Este bono tiene tasa variable. Los cupones futuros se proyectan a la última tasa
            conocida como supuesto — los pagos reales pueden diferir cuando la tasa se ajuste.
          </span>
        </div>
      )}

      <div className="overflow-auto rounded-lg border border-zinc-800">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Fecha</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Monto ({currencyCode})</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flows.map((flow, idx) => (
              <TableRow key={`${flow.date}-${flow.flowType}-${idx}`}>
                <TableCell className="font-mono text-sm text-zinc-300">
                  {formatFullDate(flow.date)}
                </TableCell>
                <TableCell>
                  {flow.flowType === "COUPON" ? (
                    <Badge className="bg-teal-900/50 text-teal-300 hover:bg-teal-900/50 border-teal-800">
                      Cupón
                    </Badge>
                  ) : (
                    <Badge className="bg-violet-900/50 text-violet-300 hover:bg-violet-900/50 border-violet-800">
                      Amortización
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-zinc-200">
                  {formatMoney(flow.amount, currencyCode)}
                </TableCell>
                <TableCell className="text-right">
                  {flow.assumedRate && (
                    <span className="text-[11px] text-amber-500 italic">tasa asumida</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
