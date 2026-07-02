"use client";

import type { BondAnalytics } from "@/lib/bonds/types";
import { cn } from "@/lib/utils";

type Props = {
  analytics: BondAnalytics | null;
  ticker: string;
  onEnterTerms?: () => void;
};

function formatPct(value: number | null, decimals = 2): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

function formatYears(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(2)} yr`;
}

export function BondAnalyticsCard({ analytics, ticker, onEnterTerms }: Props) {
  // No terms entered
  if (!analytics || analytics.noTerms) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
        <p className="text-xs text-zinc-500">
          No bond terms entered for {ticker}.{" "}
          {onEnterTerms ? (
            <button
              onClick={onEnterTerms}
              className="text-teal-400 underline underline-offset-2 hover:text-teal-300"
            >
              Enter terms
            </button>
          ) : (
            "Enter terms to enable YTM and duration analytics."
          )}
        </p>
      </div>
    );
  }

  // Edge cases
  if (analytics.invalidPrice) {
    return (
      <div className="rounded-lg border border-rose-900/50 bg-rose-950/20 px-4 py-2 text-xs text-rose-300">
        Invalid market price — analytics unavailable.
      </div>
    );
  }

  if (analytics.matured) {
    return (
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/40 px-4 py-2 text-xs text-zinc-400">
        Bond matured — no future cash flows to discount.
      </div>
    );
  }

  if (analytics.noConvergence) {
    return (
      <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-2 text-xs text-amber-300">
        YTM solver did not converge — check bond terms and market price.
      </div>
    );
  }

  // Price unavailable (analytics fields will be null but no specific flag)
  if (analytics.ytm === null) {
    return (
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/40 px-4 py-2 text-xs text-zinc-400">
        Price unavailable — analytics will appear once market data loads.
      </div>
    );
  }

  const metrics: { label: string; value: string; subtitle?: string }[] = [
    {
      label: "TIR / YTM",
      value: formatPct(analytics.ytm),
      subtitle: "Rendimiento anual al vencimiento",
    },
    {
      label: "Macaulay Duration",
      value: formatYears(analytics.macaulayDuration),
      subtitle: "Weighted avg. time to cash flows",
    },
    {
      label: "Modified Duration",
      value: formatYears(analytics.modifiedDuration),
      subtitle: "Price sensitivity per 1% yield shift",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {metrics.map((m) => (
        <div
          key={m.label}
          className={cn(
            "rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 space-y-0.5"
          )}
        >
          <p className="text-xs text-zinc-400">{m.label}</p>
          <p className="font-mono text-lg font-semibold text-zinc-100">{m.value}</p>
          {m.subtitle && <p className="text-[11px] text-zinc-500">{m.subtitle}</p>}
        </div>
      ))}
    </div>
  );
}
