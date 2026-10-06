"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  History,
  Layers,
  LayoutDashboard,
  Loader2,
  RotateCcw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  checkImportDuplicatesAction,
  commitImportAction,
  getAmortizedTickersAction,
  type ImportContextData,
} from "@/app/actions/imports";
import { AutoClearCard } from "@/components/imports/auto-clear-card";
import { ImportUploadStep } from "@/components/imports/import-upload-step";
import { UnifiedReviewStep } from "@/components/imports/unified-review-step";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AUTO_CLEAR_CATEGORIES,
  computeAutoClearSummary,
  getExcludedRowNumbersForCategories,
  collectTickers,
  type AutoClearReason,
  type AutoClearSummary,
} from "@/lib/importers/auto-clear";
import type { DuplicateBatch, DuplicateRow } from "@/lib/importers/duplicates";
import { parseImportFile } from "@/lib/importers/parse-workbook";
import { applyRowPatch, computeRowStats } from "@/lib/importers/row-validation";
import type {
  BrokerImportCode,
  CommitImportRow,
  ImportPreviewSummary,
  NormalizedImportRow,
  RowPatch,
} from "@/lib/importers/types";
import { cn } from "@/lib/utils";

type WizardStep = "upload" | "autoclear" | "review" | "done";

type ImportWizardProps = {
  context: ImportContextData;
};

const ALL_AUTOCLEAR_REASONS: AutoClearReason[] = [
  "cash_movement",
  "unsupported_instrument",
  "amortized_ticker",
  "adjustment",
];

export function ImportWizard({ context }: ImportWizardProps) {
  const router = useRouter();

  const [step, setStep] = useState<WizardStep>("upload");
  const [brokerCode, setBrokerCode] = useState<BrokerImportCode>("BALANZ");

  const [portfolioId, setPortfolioId] = useState(
    () => context.portfolios.find((p) => p.isDefault)?.id ?? context.portfolios[0]?.id ?? ""
  );
  const [brokerAccountId, setBrokerAccountId] = useState(
    () => context.brokerAccounts.find((a) => a.broker.code === "BALANZ")?.id ?? ""
  );

  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Datos del archivo y filas
  const [preview, setPreview] = useState<ImportPreviewSummary | null>(null);
  const [rows, setRows] = useState<NormalizedImportRow[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  // Auto-Clear
  const [autoClearSummary, setAutoClearSummary] = useState<AutoClearSummary | null>(null);
  const [activeAutoClearCategories, setActiveAutoClearCategories] = useState<Set<AutoClearReason>>(
    new Set(ALL_AUTOCLEAR_REASONS)
  );

  // Duplicados
  // Se calcula una vez al parsear; las filas marcadas arrancan excluidas pero el
  // marcador persiste aunque el usuario las reincorpore.
  const [duplicateByRow, setDuplicateByRow] = useState<Map<number, DuplicateRow>>(new Map());
  const [sameFileBatches, setSameFileBatches] = useState<DuplicateBatch[]>([]);
  const [duplicateCheckFailed, setDuplicateCheckFailed] = useState(false);

  // Commit
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    duplicatesImported: number;
  } | null>(null);

  const resetAll = useCallback(() => {
    setStep("upload");
    setPreview(null);
    setRows([]);
    setExcluded(new Set());
    setAutoClearSummary(null);
    setActiveAutoClearCategories(new Set(ALL_AUTOCLEAR_REASONS));
    setDuplicateByRow(new Map());
    setSameFileBatches([]);
    setDuplicateCheckFailed(false);
    setResult(null);
    setError(null);
    setParsing(false);
    setCommitting(false);
  }, []);

  // ---------------------------------------------------------------------------
  // Paso 1: Carga y Procesamiento Proactivo
  // ---------------------------------------------------------------------------

  const handleFile = useCallback(
    async (file: File) => {
      setParsing(true);
      setError(null);
      try {
        const parsed = await parseImportFile(brokerCode, file);
        if (parsed.rows.length === 0) {
          setError("El archivo cargado no contiene operaciones.");
          setPreview(null);
          return;
        }

        // Resolución proactiva de tickers amortizados
        const tickers = collectTickers(parsed.rows);
        const amortizedResult = await getAmortizedTickersAction(tickers);
        const amortizedSet = new Set(
          "error" in amortizedResult ? [] : amortizedResult
        );

        // Curaduría y cálculo de Auto-Clear proactivo
        const summary = computeAutoClearSummary(parsed.rows, amortizedSet);
        const defaultExcluded = getExcludedRowNumbersForCategories(
          summary,
          new Set(ALL_AUTOCLEAR_REASONS)
        );

        // Pre-excluir además las que vengan con error de parseo (status === "invalid")
        const invalidRowNumbers = parsed.rows
          .filter((r) => r.status === "invalid")
          .map((r) => r.rowNumber);

        // Detección proactiva de duplicados contra lo ya registrado en la cuenta.
        // Un fallo no bloquea el import: se avisa y se sigue sin marcas.
        const duplicateMap = new Map<number, DuplicateRow>();
        let batches: DuplicateBatch[] = [];
        let checkFailed = false;
        try {
          const check = await checkImportDuplicatesAction({
            brokerCode,
            fileHash: parsed.fileHash,
            brokerAccountId: brokerAccountId || undefined,
            rows: parsed.rows.flatMap((r) =>
              r.status !== "invalid" && r.parsed
                ? [{ rowNumber: r.rowNumber, status: r.status, parsed: r.parsed }]
                : []
            ),
          });
          if ("error" in check) {
            checkFailed = true;
          } else {
            batches = check.sameFileBatches;
            for (const d of check.duplicateRows) duplicateMap.set(d.rowNumber, d);
          }
        } catch (err) {
          console.error(err);
          checkFailed = true;
        }

        const initialExcluded = new Set([
          ...defaultExcluded,
          ...invalidRowNumbers,
          ...duplicateMap.keys(),
        ]);

        setPreview(parsed);
        setRows(parsed.rows);
        setAutoClearSummary(summary);
        setExcluded(initialExcluded);
        setDuplicateByRow(duplicateMap);
        setSameFileBatches(batches);
        setDuplicateCheckFailed(checkFailed);

        // Si el archivo tiene movimientos a limpiar, vamos a Auto-Clear; si no, directo a Revisión
        if (summary.totalExcluded > 0) {
          setStep("autoclear");
        } else {
          setStep("review");
        }
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo leer el archivo. Verificá que sea una exportación válida de Balanz."
        );
        setPreview(null);
      } finally {
        setParsing(false);
      }
    },
    [brokerCode, brokerAccountId]
  );

  // ---------------------------------------------------------------------------
  // Paso 2: Interacciones de Auto-Clear
  // ---------------------------------------------------------------------------

  function handleToggleAutoClearCategory(reason: AutoClearReason) {
    if (!autoClearSummary) return;

    setActiveAutoClearCategories((prev) => {
      const next = new Set(prev);
      if (next.has(reason)) {
        next.delete(reason);
      } else {
        next.add(reason);
      }

      // Re-sincronizar conjunto de excluidos
      const baseFromCategories = getExcludedRowNumbersForCategories(autoClearSummary, next);
      // Mantener filas inválidas excluidas por seguridad
      const invalidRowNumbers = rows.filter((r) => r.status === "invalid").map((r) => r.rowNumber);
      setExcluded(new Set([...baseFromCategories, ...invalidRowNumbers, ...duplicateByRow.keys()]));

      return next;
    });
  }

  function handleSelectAllCategories() {
    if (!autoClearSummary) return;
    const all = new Set(ALL_AUTOCLEAR_REASONS);
    setActiveAutoClearCategories(all);
    const base = getExcludedRowNumbersForCategories(autoClearSummary, all);
    const invalidRowNumbers = rows.filter((r) => r.status === "invalid").map((r) => r.rowNumber);
    setExcluded(new Set([...base, ...invalidRowNumbers, ...duplicateByRow.keys()]));
  }

  function handleClearAllCategories() {
    setActiveAutoClearCategories(new Set());
    // Solo dejar las inválidas y las posibles duplicadas
    const invalidRowNumbers = rows.filter((r) => r.status === "invalid").map((r) => r.rowNumber);
    setExcluded(new Set([...invalidRowNumbers, ...duplicateByRow.keys()]));
  }

  // ---------------------------------------------------------------------------
  // Paso 3: Edición de Filas en Revisión
  // ---------------------------------------------------------------------------

  function handlePatchRow(rowNumber: number, patch: RowPatch) {
    setRows((prev) =>
      prev.map((r) => (r.rowNumber === rowNumber ? applyRowPatch(r, patch) : r))
    );
    // Si la fila estaba omitida por error y se corrigió, la incluimos
    setExcluded((prev) => {
      if (!prev.has(rowNumber)) return prev;
      const next = new Set(prev);
      next.delete(rowNumber);
      return next;
    });
  }

  function handleResetRow(rowNumber: number) {
    const original = preview?.rows.find((r) => r.rowNumber === rowNumber);
    if (!original) return;
    setRows((prev) => prev.map((r) => (r.rowNumber === rowNumber ? original : r)));
  }

  function handleToggleRow(rowNumber: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  }

  function handleSetExcluded(rowNumbers: number[]) {
    setExcluded(new Set(rowNumbers));
  }

  // ---------------------------------------------------------------------------
  // Detección de Duplicados y Guardado (Commit)
  // ---------------------------------------------------------------------------

  const commitRows: CommitImportRow[] = useMemo(
    () =>
      rows
        .filter((r) => !excluded.has(r.rowNumber) && r.status !== "invalid" && r.parsed)
        .map((r) => ({
          rowNumber: r.rowNumber,
          status: r.status,
          parsed: r.parsed!,
          edited: r.edited,
        })),
    [rows, excluded]
  );

  const canCommit = commitRows.length > 0;

  async function handleReviewCommitClick() {
    if (!preview || !canCommit) return;
    await executeCommit();
  }

  async function executeCommit() {
    if (!preview) return;

    setCommitting(true);
    setError(null);

    try {
      const commit = await commitImportAction({
        brokerCode,
        fileName: preview.fileName,
        fileHash: preview.fileHash,
        portfolioId: portfolioId || undefined,
        brokerAccountId: brokerAccountId || undefined,
        rows: commitRows,
        // Todo choque de hash ya viene marcado y excluido: si una fila sigue
        // incluida, fue decisión del usuario, así que se inserta igual. Si el
        // chequeo falló no hubo marcas, y "skip" es la única red contra re-imports.
        duplicateStrategy: duplicateCheckFailed ? "skip" : "import",
      });

      if (!commit.ok) {
        setError(commit.error);
        toast.error(commit.error);
        return;
      }

      setResult({
        imported: commit.imported,
        skipped: commit.skipped,
        duplicatesImported: commit.duplicatesImported,
      });
      setStep("done");
      toast.success(
        commit.imported === 0
          ? "No se importaron movimientos nuevos"
          : `Se importaron ${commit.imported} transacciones exitosamente`
      );
      router.refresh();
    } finally {
      setCommitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render del Stepper Visual
  // ---------------------------------------------------------------------------

  const stats = useMemo(() => computeRowStats(rows, excluded), [rows, excluded]);
  // Omitidas por ser posible duplicado (no las limpió el Auto-Clear).
  const duplicatesLeftOut = useMemo(
    () => [...duplicateByRow.keys()].filter((n) => excluded.has(n)).length,
    [duplicateByRow, excluded]
  );

  return (
    <div className="space-y-8">
      {/* Indicador Stepper Horizontal */}
      <div className="mx-auto max-w-5xl">
        <div className="grid grid-cols-4 items-center gap-2 border-b border-zinc-800 pb-5">
          <StepBadge
            number={1}
            title="Origen & Archivo"
            active={step === "upload"}
            completed={step !== "upload"}
          />
          <StepBadge
            number={2}
            title="Auto-Clear"
            active={step === "autoclear"}
            completed={step === "review" || step === "done"}
          />
          <StepBadge
            number={3}
            title="Revisión"
            active={step === "review"}
            completed={step === "done"}
          />
          <StepBadge
            number={4}
            title="Listo"
            active={step === "done"}
            completed={step === "done"}
          />
        </div>
      </div>

      {/* Pantalla 1: Upload */}
      {step === "upload" && (
        <ImportUploadStep
          context={context}
          brokerCode={brokerCode}
          onBrokerCodeChange={setBrokerCode}
          portfolioId={portfolioId}
          onPortfolioIdChange={setPortfolioId}
          brokerAccountId={brokerAccountId}
          onBrokerAccountIdChange={setBrokerAccountId}
          parsing={parsing}
          onFile={handleFile}
          error={error}
        />
      )}

      {/* Pantalla 2: Auto-Clear */}
      {step === "autoclear" && autoClearSummary && (
        <AutoClearCard
          summary={autoClearSummary}
          rows={rows}
          activeCategories={activeAutoClearCategories}
          onToggleCategory={handleToggleAutoClearCategory}
          onSelectAllCategories={handleSelectAllCategories}
          onClearAllCategories={handleClearAllCategories}
          onContinue={() => setStep("review")}
          onBack={resetAll}
        />
      )}

      {/* Pantalla 3: Revisión + Duplicados Inline */}
      {step === "review" && preview && (
        <div className="space-y-6">
          {(duplicateByRow.size > 0 || sameFileBatches.length > 0 || duplicateCheckFailed) && (
            <div className="mx-auto max-w-6xl space-y-2">
              {duplicateByRow.size > 0 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-300">
                  <Copy className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <span>
                    <strong>
                      {duplicateByRow.size}{" "}
                      {duplicateByRow.size === 1 ? "movimiento parece" : "movimientos parecen"}{" "}
                      ya registrados.
                    </strong>{" "}
                    Los omitimos por vos; podés reincorporar cualquiera desde la tabla si
                    corresponde importarlo.
                  </span>
                </div>
              )}
              {sameFileBatches.length > 0 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <span>
                    <strong>Este mismo archivo ya se importó antes</strong> (
                    {sameFileBatches[0]?.fileName}
                    {sameFileBatches.length > 1 ? ` y ${sameFileBatches.length - 1} más` : ""}).
                  </span>
                </div>
              )}
              {duplicateCheckFailed && (
                <div className="flex items-start gap-2.5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
                  <span>
                    No pudimos verificar duplicados contra tu cartera. Revisá las filas antes de
                    importar.
                  </span>
                </div>
              )}
            </div>
          )}

          <UnifiedReviewStep
            preview={preview}
            rows={rows}
            excluded={excluded}
            onToggleRow={handleToggleRow}
            onSetExcluded={handleSetExcluded}
            onPatchRow={handlePatchRow}
            onResetRow={handleResetRow}
            onConfirmImport={handleReviewCommitClick}
            onBackToAutoClear={() => setStep("autoclear")}
            committing={committing}
            canCommit={canCommit}
            duplicateByRow={duplicateByRow}
          />
        </div>
      )}

      {/* Pantalla 4: Éxito y Siguientes Pasos */}
      {step === "done" && result && (
        <div className="mx-auto max-w-2xl space-y-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
            <CheckCircle2 className="h-8 w-8" />
          </div>

          <div className="space-y-1">
            <h2 className="text-2xl font-bold tracking-tight text-zinc-100">
              ¡Importación completada con éxito!
            </h2>
            <p className="text-sm text-zinc-400">
              Tus transacciones ya están registradas y calculando métricas para tu cartera.
            </p>
          </div>

          {/* Tarjetas de Resumen */}
          <div className="grid grid-cols-3 gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 text-left">
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Guardadas
              </p>
              <p className="text-2xl font-semibold tabular-nums text-emerald-400">
                {result.imported}
              </p>
              <p className="text-[11px] text-zinc-400">movimientos nuevos</p>
            </div>

            <div className="space-y-1 border-l border-zinc-800 pl-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Auto-Cleared
              </p>
              <p className="text-2xl font-semibold tabular-nums text-zinc-300">
                {stats.excluded - duplicatesLeftOut}
              </p>
              <p className="text-[11px] text-zinc-400">omitidas limpiamente</p>
            </div>

            <div className="space-y-1 border-l border-zinc-800 pl-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Duplicados
              </p>
              <p className="text-2xl font-semibold tabular-nums text-amber-400">
                {duplicatesLeftOut + result.skipped}
              </p>
              <p className="text-[11px] text-zinc-400">repetidas ignoradas</p>
            </div>
          </div>

          {/* Notificación de Backfill en Segundo Plano */}
          <div className="flex items-center gap-2.5 rounded-lg border border-teal-900/40 bg-teal-950/20 p-3 text-left text-xs text-teal-300">
            <Sparkles className="h-4 w-4 shrink-0 text-teal-400" />
            <span>
              <strong>Sincronización en curso:</strong> Estamos consultando cotizaciones
              históricas y actualizando tus gráficos de rendimientos en segundo plano.
            </span>
          </div>

          {/* Botones de Acción Inmediata */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button asChild className="gap-2">
              <Link href="/dashboard">
                <LayoutDashboard className="h-4 w-4" />
                Ir al Dashboard
              </Link>
            </Button>

            <Button asChild variant="outline" className="gap-2">
              <Link href="/imports">
                <History className="h-4 w-4" />
                Ver historial de imports
              </Link>
            </Button>

            <Button type="button" variant="ghost" onClick={resetAll} className="gap-2 text-zinc-400">
              <RotateCcw className="h-3.5 w-3.5" />
              Importar otro archivo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepBadge({
  number,
  title,
  active,
  completed,
}: {
  number: number;
  title: string;
  active: boolean;
  completed: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold transition-colors",
          completed
            ? "bg-teal-500/20 text-teal-400 border border-teal-500/40"
            : active
              ? "bg-teal-500 text-zinc-950"
              : "bg-zinc-800 text-zinc-400"
        )}
      >
        {completed ? "✓" : number}
      </span>
      <span
        className={cn(
          "text-xs font-medium truncate",
          active ? "text-zinc-100" : completed ? "text-teal-400/90" : "text-zinc-500"
        )}
      >
        {title}
      </span>
    </div>
  );
}
