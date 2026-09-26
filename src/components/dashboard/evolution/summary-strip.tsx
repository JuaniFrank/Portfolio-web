import { formatSignedPercentOrEmpty, returnToneClass } from "@/components/rendimientos/chart-utils";
import { cn } from "@/lib/utils";
import type { RangeSummary } from "@/lib/dashboard/evolution-view";
import { formatMoney, type ViewCurrency } from "../format";

type Props = {
  summary: RangeSummary;
  currency: ViewCurrency;
};

/** Resumen del rango visible: arriba del chart, recalculado con cada zoom/recorte. */
export function SummaryStrip({ summary, currency }: Props) {
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Valor inicial" value={formatMoney(summary.startValue, currency)} />
        <Stat label="Valor final" value={formatMoney(summary.endValue, currency)} />
        <Stat label="Aportes netos" value={formatSignedMoney(summary.netContributions, currency)} />
        <Stat
          label="Resultado"
          value={formatSignedMoney(summary.result, currency)}
          className={returnToneClass(summary.result)}
        />
        <Stat
          label="Rendimiento %"
          value={formatSignedPercentOrEmpty(summary.returnPercent)}
          className={returnToneClass(summary.returnPercent)}
        />
        <Stat
          label="Máx. caída"
          value={`${summary.maxDrawdown.toLocaleString("es-AR", { maximumFractionDigits: 2 })}%`}
          className="text-rose-400"
        />
      </div>

      {summary.estimatedPrices ? (
        <p className="text-[11px] text-amber-300/80">
          Incluye valores estimados de ONs en el rango visible.
        </p>
      ) : null}
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={cn("mt-0.5 font-medium tabular-nums text-zinc-100", className)}>{value}</p>
    </div>
  );
}

/** Importe con signo explícito: en un resultado el signo es la información principal. */
function formatSignedMoney(value: number, currency: ViewCurrency): string {
  return `${value > 0 ? "+" : ""}${formatMoney(value, currency)}`;
}
