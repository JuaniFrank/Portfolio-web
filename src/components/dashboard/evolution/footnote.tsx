import { EMPTY_VALUE, formatDateLong } from "@/components/rendimientos/chart-utils";
import type { PortfolioEvolution } from "@/lib/dashboard/evolution";
import { formatDayMonth } from "@/lib/dashboard/evolution-chart";

export function Footnote({
  evolution,
  estimatedCutoff,
}: {
  evolution: PortfolioEvolution;
  estimatedCutoff: string | null;
}) {
  if (!evolution.hasData) return null;

  return (
    <div className="space-y-1">
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Reconstruido desde las operaciones y los cierres diarios, no desde fotos guardadas:
        corregir una operación vieja se refleja en todo el histórico. Incluye acciones,
        CEDEARs y ONs. Último cierre:{" "}
        {evolution.lastDate ? formatDateLong(evolution.lastDate) : EMPTY_VALUE}.
      </p>
      {estimatedCutoff ? (
        <p className="text-[11px] leading-relaxed text-amber-300/80">
          Los valores de ONs anteriores al {formatDayMonth(estimatedCutoff)} se estiman con
          valor técnico (residual × USD 1 × CCL del día).
        </p>
      ) : null}
    </div>
  );
}
