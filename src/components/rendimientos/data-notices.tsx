"use client";

import { AlertTriangle, DatabaseZap, Info } from "lucide-react";
import { formatMonthLabel } from "@/lib/rendimientos/months";
import type { DataQuality, ExcludedHolding } from "@/lib/rendimientos/types";
import { cn } from "@/lib/utils";

/**
 * Avisos de alcance y calidad del dato.
 *
 * Existe porque un rendimiento que silenciosamente ignora parte de la cartera, o que
 * arrastra precios viejos sin decirlo, es peor que no mostrar rendimiento: el usuario
 * toma decisiones creyendo que el número es completo. Todo lo que el motor no pudo
 * medir se declara acá.
 */
export function DataNotices({
  quality,
  excludedHoldings,
}: {
  quality: DataQuality;
  excludedHoldings: ExcludedHolding[];
}) {
  const noBackfill = quality.lastPriceSyncDate === null;

  return (
    <div className="space-y-2">
      {noBackfill ? (
        <Notice tone="warning" icon={DatabaseZap} title="Falta el histórico de precios">
          Todavía no hay precios históricos cargados, así que no se puede reconstruir la
          serie. Corré el backfill:{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11px]">
            /api/cron/backfill-macro
          </code>{" "}
          y después{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-[11px]">
            /api/cron/backfill-prices
          </code>
          .
        </Notice>
      ) : null}

      {excludedHoldings.length > 0 ? (
        <Notice tone="info" icon={Info} title="Qué queda fuera de este cálculo">
          <p>
            Estos activos que tenés en cartera no entran en el rendimiento porque no hay
            serie de precios histórica para valuarlos mes a mes:
          </p>
          <ul className="mt-1.5 space-y-1">
            {excludedHoldings.map((holding) => (
              <li key={holding.ticker} className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="font-medium text-zinc-300">{holding.ticker}</span>
                <span className="text-zinc-500">— {holding.reason}</span>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {quality.impliedNegativeCash ? (
        <Notice tone="warning" icon={AlertTriangle} title="Faltan aportes en tus datos">
          Las compras registradas superan el efectivo disponible, así que hay depósitos que
          no están cargados. Cuando falta un aporte, parte del capital invertido se computa
          como ganancia y{" "}
          <span className="font-medium text-amber-300">el rendimiento queda sobrestimado</span>.
          Cargá los depósitos faltantes para que los números cierren.
        </Notice>
      ) : null}

      {quality.partialMonths.length > 0 ? (
        <Notice tone="warning" icon={AlertTriangle} title="Meses con precios arrastrados">
          En {quality.partialMonths.length === 1 ? "este mes" : "estos meses"} algún
          instrumento no tuvo cotización y se usó su último precio conocido:{" "}
          <span className="text-zinc-300">
            {quality.partialMonths.map(formatMonthLabel).join(", ")}
          </span>
          . Están marcados con un triángulo en la tabla.
        </Notice>
      ) : null}

      {quality.missingCclMonths.length > 0 ? (
        <Notice tone="warning" icon={AlertTriangle} title="Meses sin cotización de CCL">
          Sin CCL no se puede convertir a dólares, así que la vista en USD de{" "}
          <span className="text-zinc-300">
            {quality.missingCclMonths.map(formatMonthLabel).join(", ")}
          </span>{" "}
          no es confiable.
        </Notice>
      ) : null}
    </div>
  );
}

type Tone = "info" | "warning";

const TONES: Record<Tone, { container: string; icon: string; title: string }> = {
  info: {
    container: "border-zinc-800 bg-zinc-900/40",
    icon: "text-teal-400",
    title: "text-zinc-200",
  },
  warning: {
    container: "border-amber-900/50 bg-amber-950/20",
    icon: "text-amber-400",
    title: "text-amber-200",
  },
};

function Notice({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: Tone;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  const styles = TONES[tone];
  return (
    <div className={cn("flex gap-3 rounded-xl border p-3", styles.container)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", styles.icon)} />
      <div className="min-w-0 space-y-1 text-xs leading-relaxed text-zinc-400">
        <p className={cn("font-medium", styles.title)}>{title}</p>
        {children}
      </div>
    </div>
  );
}
