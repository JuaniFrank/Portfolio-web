"use client";

import { InfoIcon } from "lucide-react";
import Decimal from "decimal.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { UpcomingFlow } from "@/lib/bonds/types";
import { formatFullDate, formatMoney, formatNumber, type ViewCurrency } from "./format";

type Props = {
  flows: UpcomingFlow[];
  /** Must be "USD" or "ARS" to match ViewCurrency. */
  currencyCode: ViewCurrency;
  ticker: string;
  hasTerms: boolean;
  /** Day-count convention label for the "días del período" column header. */
  dayCountConvention?: string | null;
  onEnterTerms?: () => void;
};

/** One row per payment date: coupon interest and amortization shown side by side. */
type ScheduleRow = {
  seq: number;
  date: string;
  periodDays: number | null;
  interest: Decimal;
  amortization: Decimal;
  total: Decimal;
  assumedRate: boolean;
};

/**
 * Collapse the flat coupon/amortization flow list into one row per payment date,
 * so a maturity date that pays both a coupon and principal shows a single row.
 * Input is assumed chronological (projectCashFlows sorts ascending).
 */
function groupByPaymentDate(flows: UpcomingFlow[]): ScheduleRow[] {
  const byDate = new Map<string, ScheduleRow>();

  for (const f of flows) {
    const row: ScheduleRow =
      byDate.get(f.date) ?? {
        seq: 0,
        date: f.date,
        periodDays: null,
        interest: new Decimal(0),
        amortization: new Decimal(0),
        total: new Decimal(0),
        assumedRate: false,
      };

    const amount = new Decimal(f.amount);
    if (f.flowType === "COUPON") {
      row.interest = row.interest.plus(amount);
      if (f.periodDays !== null) row.periodDays = f.periodDays;
      if (f.assumedRate) row.assumedRate = true;
    } else {
      row.amortization = row.amortization.plus(amount);
    }
    row.total = row.total.plus(amount);

    byDate.set(f.date, row);
  }

  const rows = Array.from(byDate.values());
  rows.forEach((row, index) => {
    row.seq = index + 1;
  });
  return rows;
}

/** Currency amount prefixed with ≈ to signal it is a projection, or "—" for zero. */
function estimated(value: Decimal, currency: ViewCurrency): string {
  if (value.isZero()) return "—";
  return `≈ ${formatMoney(value.toFixed(2), currency)}`;
}

export function BondProjectionTable({
  flows,
  currencyCode,
  ticker,
  hasTerms,
  dayCountConvention,
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

  const rows = groupByPaymentDate(flows);
  const hasAssumedRate = rows.some((r) => r.assumedRate);

  const totalInterest = rows.reduce((sum, r) => sum.plus(r.interest), new Decimal(0));
  const totalAmortization = rows.reduce((sum, r) => sum.plus(r.amortization), new Decimal(0));
  const totalFlow = rows.reduce((sum, r) => sum.plus(r.total), new Decimal(0));

  const periodHeader = dayCountConvention
    ? `Días del período (${dayCountConvention})`
    : "Días del período";

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
              <TableHead className="w-12">N°</TableHead>
              <TableHead>Fecha de pago</TableHead>
              <TableHead className="text-right">{periodHeader}</TableHead>
              <TableHead className="text-right">Interés estimado ({currencyCode})</TableHead>
              <TableHead className="text-right">Amortización ({currencyCode})</TableHead>
              <TableHead className="text-right">Flujo total ({currencyCode})</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.date}>
                <TableCell className="font-mono text-sm text-zinc-500">{row.seq}</TableCell>
                <TableCell className="font-mono text-sm text-zinc-300">
                  {formatFullDate(row.date)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-zinc-400">
                  {row.periodDays !== null ? formatNumber(row.periodDays) : "—"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-zinc-200">
                  {estimated(row.interest, currencyCode)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-zinc-200">
                  {row.amortization.isZero()
                    ? "—"
                    : formatMoney(row.amortization.toFixed(2), currencyCode)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-medium text-zinc-100">
                  {estimated(row.total, currencyCode)}
                </TableCell>
              </TableRow>
            ))}

            {/* Totals */}
            <TableRow className="border-t-2 border-zinc-700 hover:bg-transparent">
              <TableCell />
              <TableCell className="text-sm font-semibold text-zinc-200">Total</TableCell>
              <TableCell />
              <TableCell className="text-right font-mono text-sm font-semibold text-zinc-100">
                {estimated(totalInterest, currencyCode)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm font-semibold text-zinc-100">
                {totalAmortization.isZero()
                  ? "—"
                  : formatMoney(totalAmortization.toFixed(2), currencyCode)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm font-semibold text-zinc-100">
                {estimated(totalFlow, currencyCode)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
