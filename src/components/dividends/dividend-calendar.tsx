"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Info, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TickerAvatar } from "@/components/transactions/ticker-avatar";
import type { DividendMonth } from "@/lib/dividends/types";
import { cn } from "@/lib/utils";
import { formatDayMonth, formatMoney, monthName, type ViewCurrency } from "./format";

type Props = {
  months: DividendMonth[];
  currency: ViewCurrency;
};

export function DividendCalendar({ months, currency }: Props) {
  const todayKey = useMemo(() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }, []);

  const initial = Math.max(
    0,
    months.findIndex((m) => m.key === todayKey)
  );
  const [activeIndex, setActiveIndex] = useState<number>(initial);

  if (months.length === 0) return null;
  const active = months[activeIndex]!;

  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-zinc-50">Calendario de dividendos</h2>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Recibido
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-violet-500" /> Estimado
          </span>
        </div>
      </div>

      <MonthStrip
        months={months}
        currency={currency}
        activeIndex={activeIndex}
        onSelect={setActiveIndex}
        todayKey={todayKey}
      />

      <div className="flex items-center justify-between border-t border-zinc-800 pt-4">
        <Button
          variant="outline"
          size="sm"
          disabled={activeIndex === 0}
          onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Anterior
        </Button>
        <div className="text-sm font-medium text-zinc-100">
          {monthName(active.month)} {active.year}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={activeIndex === months.length - 1}
          onClick={() => setActiveIndex((i) => Math.min(months.length - 1, i + 1))}
        >
          Siguiente
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>

      <MonthDetail month={active} currency={currency} />
    </div>
  );
}

function MonthStrip({
  months,
  currency,
  activeIndex,
  onSelect,
  todayKey,
}: {
  months: DividendMonth[];
  currency: ViewCurrency;
  activeIndex: number;
  onSelect: (i: number) => void;
  todayKey: string;
}) {
  const isArs = currency === "ARS";
  const netField = isArs ? ("netArs" as const) : ("netUsd" as const);

  const maxIntensity = useMemo(() => {
    let max = 0;
    for (const m of months) {
      const total =
        m.received.reduce((s, r) => s + Number(r[netField]), 0) +
        m.upcoming.reduce((s, u) => s + Number(u.estimatedTotal), 0);
      if (total > max) max = total;
    }
    return max;
  }, [months, netField]);

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
      {months.map((m, i) => {
        const totalReceived = m.received.reduce((s, r) => s + Number(r[netField]), 0);
        const totalUpcoming = m.upcoming.reduce((s, u) => s + Number(u.estimatedTotal), 0);
        const total = totalReceived + totalUpcoming;
        const intensity = maxIntensity > 0 ? total / maxIntensity : 0;
        const isActive = i === activeIndex;
        const isCurrent = m.key === todayKey;
        const hasPayments = m.received.length > 0 || m.upcoming.length > 0;

        return (
          <button
            key={m.key}
            onClick={() => onSelect(i)}
            className={cn(
              "group flex flex-col items-stretch rounded-md border px-2 py-2 text-left transition-colors",
              isActive
                ? "border-teal-500 bg-teal-500/10"
                : isCurrent
                  ? "border-zinc-700 bg-zinc-900/80"
                  : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                {monthName(m.month).slice(0, 3)}
              </span>
              <span className="text-[10px] text-zinc-600">{String(m.year).slice(2)}</span>
            </div>
            <div
              className={cn(
                "mt-1 h-1.5 w-full rounded-full",
                hasPayments ? "bg-zinc-800" : "bg-zinc-900"
              )}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  m.received.length > 0 ? "bg-emerald-500" : "bg-violet-500"
                )}
                style={{ width: `${Math.max(intensity * 100, hasPayments ? 14 : 0)}%` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-zinc-500">
              <span>
                {m.received.length > 0 ? `${m.received.length}p` : null}
                {m.received.length > 0 && m.upcoming.length > 0 ? " · " : null}
                {m.upcoming.length > 0 ? `${m.upcoming.length}e` : null}
                {!hasPayments ? "—" : null}
              </span>
              {total > 0 ? (
                <span className="font-mono text-zinc-400">{formatMoney(total, currency)}</span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MonthDetail({ month, currency }: { month: DividendMonth; currency: ViewCurrency }) {
  console.log({ month });
  const isArs = currency === "ARS";
  if (month.received.length === 0 && month.upcoming.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-900/30 p-6 text-center text-sm text-zinc-500">
        Sin dividendos recibidos ni estimados para este mes.
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {month.received.map((r) => {
        const gross = r.currencyCode === "ARS" ? r.grossArs : r.grossUsd;
        // const tax = r.currencyCode === "ARS" ? r.taxArs : r.taxUsd;
        const tax = r.taxArs;
        const net = r.currencyCode === "ARS" ? r.netArs : r.netUsd;

        console.log({ gross });
        return (
          <div key={r.id} className="rounded-md border border-emerald-900/50 bg-emerald-950/20 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <TickerAvatar ticker={r.ticker} />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-zinc-100">{r.ticker}</p>
                    <Badge variant="success">Recibido</Badge>
                  </div>
                  <p className="text-xs text-zinc-500">{formatDayMonth(r.tradeDate)}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-semibold text-emerald-400">
                  {formatMoney(net, currency)}
                </p>
                <p className="text-[11px] text-zinc-500">neto</p>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
              <div className="rounded bg-zinc-900/60 px-2 py-1">
                <span className="text-zinc-500">Bruto:</span>{" "}
                <span className="font-mono text-zinc-200">{formatMoney(gross, currency)}</span>
              </div>
              <div className="rounded bg-zinc-900/60 px-2 py-1">
                <span className="text-zinc-500">Ret.:</span>{" "}
                <span className="font-mono text-rose-300">{formatMoney(tax, currency)}</span>
              </div>
            </div>
          </div>
        );
      })}
      {month.upcoming.map((u, idx) => (
        <div
          key={`${u.ticker}-${u.estimatedDate}-${idx}`}
          className="rounded-md border border-violet-900/50 bg-violet-950/20 p-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <TickerAvatar ticker={u.ticker} />
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-zinc-100">{u.ticker}</p>
                  <span
                    title="Estimación basada en la frecuencia histórica de pagos del ticker. La fecha y el monto son aproximados."
                    className="inline-flex items-center gap-1 rounded-md border border-violet-900/70 bg-violet-950/40 px-2 py-0.5 text-[10px] font-medium text-violet-200"
                  >
                    <Sparkles className="h-3 w-3" /> Estimado
                    <Info className="h-3 w-3 text-violet-300/60" />
                  </span>
                </div>
                <p className="text-xs text-zinc-500">{formatDayMonth(u.estimatedDate)}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="font-mono text-sm font-semibold text-violet-300">
                {formatMoney(u.estimatedTotal, u.currencyCode)}
              </p>
              <p className="text-[11px] text-zinc-500">estim. total</p>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
            <div className="rounded bg-zinc-900/60 px-2 py-1">
              <span className="text-zinc-500">Por acción:</span>{" "}
              <span className="font-mono text-zinc-200">
                {formatMoney(u.estimatedAmountPerShare, u.currencyCode)}
              </span>
            </div>
            <div className="rounded bg-zinc-900/60 px-2 py-1">
              <span className="text-zinc-500">Cantidad:</span>{" "}
              <span className="font-mono text-zinc-200">{u.quantity}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
