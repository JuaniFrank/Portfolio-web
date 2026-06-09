"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { TickerAvatar } from "@/components/transactions/ticker-avatar";
import type { TopMover } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { formatMoney, formatSignedPercent, type ViewCurrency } from "./format";

type Props = {
  gainers: TopMover[];
  losers: TopMover[];
  currency: ViewCurrency;
};

export function TopMovers({ gainers, losers, currency }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <MoverList
        title="Mejores rendimientos"
        icon={<TrendingUp className="h-4 w-4" />}
        accent="emerald"
        rows={gainers}
        currency={currency}
        emptyText="Aún no hay ganadores."
      />
      <MoverList
        title="Peores rendimientos"
        icon={<TrendingDown className="h-4 w-4" />}
        accent="rose"
        rows={losers}
        currency={currency}
        emptyText="Aún no hay perdedores. ¡Bien ahí!"
      />
    </div>
  );
}

function MoverList({
  title,
  icon,
  accent,
  rows,
  currency,
  emptyText,
}: {
  title: string;
  icon: React.ReactNode;
  accent: "emerald" | "rose";
  rows: TopMover[];
  currency: ViewCurrency;
  emptyText: string;
}) {
  const accentClass = accent === "emerald" ? "text-emerald-400" : "text-rose-400";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-md bg-zinc-800/80", accentClass)}>
          {icon}
        </span>
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-500">{emptyText}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const pnlValue = currency === "ARS" ? r.pnlArs : r.pnlUsd;
            return (
              <li
                key={r.ticker}
                className="flex items-center gap-3 rounded-lg bg-zinc-900/50 px-3 py-2"
              >
                <TickerAvatar ticker={r.ticker} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-zinc-100">{r.ticker}</p>
                  <p className="truncate text-[11px] text-zinc-500">{r.instrumentName}</p>
                </div>
                <div className="text-right">
                  <p className={cn("text-sm font-semibold tabular-nums", accentClass)}>
                    {formatSignedPercent(r.pnlPercent)}
                  </p>
                  <p className="text-[11px] tabular-nums text-zinc-500">
                    {formatMoney(pnlValue, currency)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
