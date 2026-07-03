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
          No hay términos cargados para {ticker}.{" "}
          {onEnterTerms ? (
            <button
              onClick={onEnterTerms}
              className="text-teal-400 underline underline-offset-2 hover:text-teal-300"
            >
              Cargar términos
            </button>
          ) : (
            "Cargá los términos para habilitar la analítica de TIR y duration."
          )}
        </p>
      </div>
    );
  }

  // Edge cases
  if (analytics.invalidPrice) {
    return (
      <div className="rounded-lg border border-rose-900/50 bg-rose-950/20 px-4 py-2 text-xs text-rose-300">
        Precio de mercado inválido — analítica no disponible.
      </div>
    );
  }

  if (analytics.matured) {
    return (
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/40 px-4 py-2 text-xs text-zinc-400">
        Bono vencido — no hay flujos futuros para descontar.
      </div>
    );
  }

  if (analytics.noConvergence) {
    return (
      <div className="rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-2 text-xs text-amber-300">
        El cálculo de TIR no convergió — revisá los términos y el precio de mercado.
      </div>
    );
  }

  // Price unavailable (analytics fields will be null but no specific flag)
  if (analytics.ytm === null) {
    return (
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/40 px-4 py-2 text-xs text-zinc-400">
        Precio no disponible — la analítica aparecerá cuando carguen los datos de mercado.
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
      label: "Duration de Macaulay",
      value: formatYears(analytics.macaulayDuration),
      subtitle: "Tiempo promedio ponderado de los flujos",
    },
    {
      label: "Duration modificada",
      value: formatYears(analytics.modifiedDuration),
      subtitle: "Sensibilidad del precio ante +1% de tasa",
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
