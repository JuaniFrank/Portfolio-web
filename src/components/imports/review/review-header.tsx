import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { computeRowStats } from "@/lib/importers/row-validation";
import type { ImportPreviewSummary } from "@/lib/importers/types";

type ReviewHeaderProps = {
  preview: ImportPreviewSummary;
  stats: ReturnType<typeof computeRowStats>;
  onBackToAutoClear: () => void;
  onConfirmImport: () => void;
  committing: boolean;
  canCommit: boolean;
};

/** Título del paso, resumen del archivo y acciones principales (volver / importar). */
export function ReviewHeader({
  preview,
  stats,
  onBackToAutoClear,
  onConfirmImport,
  committing,
  canCommit,
}: ReviewHeaderProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
          Paso 3: Revisión y Conciliación
        </h2>
        <p className="text-xs text-zinc-400">
          Archivo: <span className="font-medium text-zinc-200">{preview.fileName}</span> ·{" "}
          {stats.total} movimientos totales
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onBackToAutoClear}>
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
          Volver al Auto-Clear
        </Button>

        <Button
          type="button"
          size="sm"
          onClick={onConfirmImport}
          disabled={!canCommit || committing}
          className="gap-1.5"
        >
          {committing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Importando…
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Importar {stats.committable} movimientos
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
