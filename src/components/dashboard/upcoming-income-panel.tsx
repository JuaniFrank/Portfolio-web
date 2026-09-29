"use client";

import * as React from "react";
import { AlertTriangle, Banknote, CalendarClock } from "lucide-react";
import { getUpcomingIncomeAction } from "@/app/actions/upcoming-income";
import type { UpcomingIncomeActionResult } from "@/app/actions/upcoming-income";
import { formatDDMM } from "@/lib/dashboard/period-kpis";
import type { UpcomingIncomeKind, UpcomingIncomeRow } from "@/lib/dashboard/upcoming-income";
import { cn } from "@/lib/utils";
import { formatMoney, type ViewCurrency } from "./format";
import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  currency: ViewCurrency;
};

type Window = 30 | 60 | 90;

const WINDOW_OPTIONS: Window[] = [30, 60, 90];

const KIND_LABELS: Record<UpcomingIncomeKind, string> = {
  coupon: "Cupón",
  amortization: "Amortización",
  dividend: "Dividendo estimado",
};

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: UpcomingIncomeActionResult };

/**
 * "Próximos cobros": cupones/amortizaciones de ONs (contractuales) y
 * dividendos estimados (cadencia Yahoo), unificados por `buildUpcomingIncome`.
 *
 * Se carga desde el cliente DESPUÉS de que la pestaña "Hoy" ya renderizó —
 * la proyección de dividendos golpea Yahoo por ticker y no puede demorar el
 * resto del dashboard (ver diseño en `odd/tasks/dashboard-reorg-phase2.md`).
 */
export function UpcomingIncomePanel({ currency }: Props) {
  const [state, setState] = React.useState<LoadState>({ status: "loading" });
  const [windowDays, setWindowDays] = React.useState<Window>(30);

  React.useEffect(() => {
    let cancelled = false;
    getUpcomingIncomeAction()
      .then((res) => {
        if (cancelled) return;
        if ("error" in res) {
          setState({ status: "error" });
          return;
        }
        setState({ status: "ready", data: res });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <CalendarClock className="h-4 w-4 text-teal-400" />
          Próximos cobros
        </h3>
        <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-950/60 p-1">
          {WINDOW_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setWindowDays(option)}
              aria-pressed={windowDays === option}
              className={cn(
                "rounded px-2.5 py-1 text-xs transition-colors",
                windowDays === option
                  ? "bg-teal-500/20 font-medium text-teal-300"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              )}
            >
              {option}d
            </button>
          ))}
        </div>
      </div>

      {state.status === "loading" ? <PanelSkeleton /> : null}
      {state.status === "error" ? <PanelError /> : null}
      {state.status === "ready" ? (
        <PanelBody data={state.data} windowDays={windowDays} currency={currency} />
      ) : null}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

function PanelError() {
  return (
    <p className="flex items-center gap-2 py-6 text-center text-xs text-zinc-500">
      <AlertTriangle className="h-3.5 w-3.5 text-amber-400/80" />
      No se pudieron cargar los próximos cobros. Probá recargar la página.
    </p>
  );
}

function PanelBody({
  data,
  windowDays,
  currency,
}: {
  data: UpcomingIncomeActionResult;
  windowDays: Window;
  currency: ViewCurrency;
}) {
  const rows = data.rows.filter((row) => row.daysUntil <= windowDays);
  const total = data.totals[`d${windowDays}` as `d${Window}`];
  const totalAmount = currency === "ARS" ? total.ars : total.usd;

  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        <p className="py-6 text-center text-xs text-zinc-500">
          No hay cobros proyectados en los próximos {windowDays} días.
        </p>
        {data.dividendsUnavailable ? <DividendsUnavailableNotice /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {rows.map((row, index) => (
          <IncomeRow key={`${row.date}-${row.ticker}-${row.kind}-${index}`} row={row} currency={currency} />
        ))}
      </ul>

      <div className="flex items-center justify-between border-t border-zinc-800 pt-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-400">
          <Banknote className="h-3.5 w-3.5 text-emerald-400" />
          Total {windowDays}d
        </span>
        <span className="text-sm font-semibold tabular-nums text-zinc-100">
          {formatMoney(totalAmount, currency)}
        </span>
      </div>

      {data.dividendsUnavailable ? <DividendsUnavailableNotice /> : null}
    </div>
  );
}

function DividendsUnavailableNotice() {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-amber-400/80">
      <AlertTriangle className="h-3 w-3" />
      Algunos dividendos estimados no se pudieron calcular ahora mismo.
    </p>
  );
}

function IncomeRow({ row, currency }: { row: UpcomingIncomeRow; currency: ViewCurrency }) {
  const amount = currency === "ARS" ? row.amountArs : row.amountUsd;
  const daysLabel = row.daysUntil === 0 ? "hoy" : `en ${row.daysUntil} ${row.daysUntil === 1 ? "día" : "días"}`;

  return (
    <li className="flex min-w-0 items-center justify-between gap-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 tabular-nums text-zinc-500">{formatDDMM(row.date)}</span>
        <span className="min-w-0 truncate font-medium text-zinc-200">{row.ticker}</span>
        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
          {KIND_LABELS[row.kind]}
          {row.estimated ? " · est." : ""}
        </span>
      </div>
      <div className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
        <span className="text-[10px] text-zinc-600">{daysLabel}</span>
        <span className="tabular-nums font-medium text-zinc-100">
          {amount !== null ? formatMoney(amount, currency) : "—"}
        </span>
      </div>
    </li>
  );
}
