"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import type { ConcentrationStats } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { formatPercent } from "./format";

type Props = {
  stats: ConcentrationStats;
};

const LEVEL_META: Record<ConcentrationStats["level"], {
  label: string;
  helper: string;
  color: string;
  bar: string;
  ring: string;
}> = {
  baja: {
    label: "Baja",
    helper: "Buena diversificación entre instrumentos.",
    color: "text-emerald-400",
    bar: "bg-emerald-500",
    ring: "ring-emerald-500/30",
  },
  moderada: {
    label: "Moderada",
    helper: "Diversificación razonable. Vigilar posiciones grandes.",
    color: "text-sky-400",
    bar: "bg-sky-500",
    ring: "ring-sky-500/30",
  },
  alta: {
    label: "Alta",
    helper: "Algunas pocas posiciones dominan el portfolio.",
    color: "text-amber-400",
    bar: "bg-amber-500",
    ring: "ring-amber-500/30",
  },
  muy_alta: {
    label: "Muy alta",
    helper: "Concentración elevada. Evaluá diversificar.",
    color: "text-rose-400",
    bar: "bg-rose-500",
    ring: "ring-rose-500/30",
  },
};

export function ConcentrationCard({ stats }: Props) {
  const meta = LEVEL_META[stats.level];
  const top5 = Math.min(100, Math.max(0, Number(stats.top5Percent)));
  const topHoldingPct = Number(stats.topHoldingPercent);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Concentración del portfolio</h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            Qué tan repartido está tu capital entre las posiciones.
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold ring-1",
            meta.color,
            meta.ring
          )}
        >
          {stats.level === "baja" ? (
            <ShieldCheck className="h-3 w-3" />
          ) : (
            <AlertTriangle className="h-3 w-3" />
          )}
          {meta.label}
        </span>
      </div>

      <div className="space-y-4">
        <Metric
          label="Top 5 posiciones"
          value={formatPercent(stats.top5Percent, 1)}
          progress={top5}
          progressClass={meta.bar}
        />

        <div className="grid grid-cols-2 gap-3 border-t border-zinc-800 pt-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Posición más grande
            </p>
            <p className="mt-1 text-lg font-semibold text-zinc-100">
              {stats.topHoldingTicker ?? "—"}{" "}
              {stats.topHoldingTicker ? (
                <span className="text-sm font-normal tabular-nums text-zinc-400">
                  · {formatPercent(topHoldingPct, 1)}
                </span>
              ) : null}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              HHI
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">
              {Number(stats.hhi).toLocaleString("es-AR")}
            </p>
          </div>
        </div>

        <p className="text-xs text-zinc-500">{meta.helper}</p>

        {stats.oversizedPositions.length > 0 ? (
          <div className="rounded-md border border-amber-900/50 bg-amber-950/20 p-2.5 text-xs text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-medium">
                  {stats.oversizedPositions.length}{" "}
                  {stats.oversizedPositions.length === 1 ? "posición pesa" : "posiciones pesan"}{" "}
                  más del 25%:
                </p>
                <p className="mt-1 text-amber-100/80">
                  {stats.oversizedPositions
                    .map((p) => `${p.ticker} (${formatPercent(p.percent, 1)})`)
                    .join(" · ")}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  progress,
  progressClass,
}: {
  label: string;
  value: string;
  progress: number;
  progressClass: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-zinc-400">{label}</span>
        <span className="text-base font-semibold tabular-nums text-zinc-100">{value}</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn("h-full rounded-full transition-all", progressClass)}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
