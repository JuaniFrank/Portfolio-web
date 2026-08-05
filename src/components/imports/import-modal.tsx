"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, ListChecks } from "lucide-react";
import { toast } from "sonner";
import {
  checkImportDuplicatesAction,
  commitImportAction,
  type ImportContextData,
} from "@/app/actions/imports";
import { FileDropzone } from "@/components/imports/file-dropzone";
import { ImportDuplicatesDialog } from "@/components/imports/import-duplicates-dialog";
import { ImportEditTable } from "@/components/imports/import-edit-table";
import { ImportPreviewTable } from "@/components/imports/import-preview-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  hasDuplicates,
  type DuplicateCheckResult,
} from "@/lib/importers/duplicates";
import { parseImportFile } from "@/lib/importers/parse-workbook";
import { BROKER_IMPORTERS } from "@/lib/importers/registry";
import { applyRowPatch, computeRowStats } from "@/lib/importers/row-validation";
import type {
  BrokerImportCode,
  CommitImportRow,
  DuplicateStrategy,
  ImportPreviewSummary,
  NormalizedImportRow,
  RowPatch,
} from "@/lib/importers/types";

type Step = "upload" | "review" | "committing" | "done";

type ImportModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: ImportContextData;
};

export function ImportModal({ open, onOpenChange, context }: ImportModalProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [brokerCode, setBrokerCode] = useState<BrokerImportCode>("BALANZ");

  // `preview` es el resultado inmutable del parser (nombre de archivo, hash).
  // `rows` es la copia de trabajo que el editor muta.
  const [preview, setPreview] = useState<ImportPreviewSummary | null>(null);
  const [rows, setRows] = useState<NormalizedImportRow[]>([]);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [editing, setEditing] = useState(false);

  const [parsing, setParsing] = useState(false);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateCheckResult | null>(null);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);

  // Los targets se inicializan de forma perezosa en vez de sincronizarse con un
  // efecto: son un valor derivado del contexto, no estado externo a React.
  const [portfolioId, setPortfolioId] = useState(
    () => context.portfolios.find((p) => p.isDefault)?.id ?? context.portfolios[0]?.id ?? ""
  );
  const [brokerAccountId, setBrokerAccountId] = useState(
    () => context.brokerAccounts.find((a) => a.broker.code === "BALANZ")?.id ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
    duplicatesImported: number;
  } | null>(null);

  const brokerOption = BROKER_IMPORTERS.find((b) => b.code === brokerCode);
  const dbBroker = context.brokers.find((b) => b.code === brokerCode);

  const accountsForBroker = useMemo(
    () => context.brokerAccounts.filter((a) => a.broker.code === brokerCode),
    [context.brokerAccounts, brokerCode]
  );

  /** Descarta el archivo y todo lo derivado. No toca portfolio ni cuenta: son
   *  selecciones del usuario que conviene conservar entre imports. */
  const resetFile = useCallback(() => {
    setStep("upload");
    setPreview(null);
    setRows([]);
    setExcluded(new Set());
    setEditing(false);
    setParsing(false);
    setCheckingDuplicates(false);
    setDuplicates(null);
    setDuplicatesOpen(false);
    setResult(null);
    setError(null);
  }, []);

  // -------------------------------------------------------------------------
  // Parseo
  // -------------------------------------------------------------------------

  const handleFile = useCallback(
    async (file: File) => {
      if (!brokerOption?.enabled) return;

      setParsing(true);
      setError(null);
      try {
        const parsed = await parseImportFile(brokerCode, file);
        if (parsed.rows.length === 0) {
          setError("El archivo no contiene movimientos.");
          setPreview(null);
          return;
        }
        setPreview(parsed);
        setRows(parsed.rows);
        // Las filas que el parser marcó como inválidas arrancan omitidas: es el
        // default seguro. El usuario puede corregirlas y volver a incluirlas.
        setExcluded(new Set(parsed.rows.filter((r) => r.status === "invalid").map((r) => r.rowNumber)));
        setEditing(false);
        setStep("review");
      } catch (e) {
        console.error(e);
        setError(
          e instanceof Error
            ? e.message
            : "No se pudo leer el archivo. Verificá que sea un export de Balanz."
        );
        setPreview(null);
      } finally {
        setParsing(false);
      }
    },
    [brokerCode, brokerOption?.enabled]
  );

  // -------------------------------------------------------------------------
  // Edición
  // -------------------------------------------------------------------------

  function handlePatchRow(rowNumber: number, patch: RowPatch) {
    setRows((prev) =>
      prev.map((r) => (r.rowNumber === rowNumber ? applyRowPatch(r, patch) : r))
    );
    // Corregir una fila que estaba omitida por inválida la vuelve a incluir:
    // es lo que el usuario acaba de pedir implícitamente al editarla.
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

  // -------------------------------------------------------------------------
  // Commit
  // -------------------------------------------------------------------------

  const stats = useMemo(() => computeRowStats(rows, excluded), [rows, excluded]);

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

  const canCommit = commitRows.length > 0 && Boolean(dbBroker?.enabled);

  /** Paso 1: chequear duplicados. Si no hay, va directo al commit. */
  async function handleImportClick() {
    if (!preview || !canCommit) return;

    setCheckingDuplicates(true);
    setError(null);
    try {
      const check = await checkImportDuplicatesAction({
        brokerCode,
        fileHash: preview.fileHash,
        brokerAccountId: brokerAccountId || undefined,
        rows: commitRows,
      });

      if ("error" in check) {
        setError(check.error);
        toast.error(check.error);
        return;
      }

      if (hasDuplicates(check)) {
        setDuplicates(check);
        setDuplicatesOpen(true);
        return;
      }

      await runCommit("skip");
    } finally {
      setCheckingDuplicates(false);
    }
  }

  /** Paso 2: guardar. Lo llama el flujo directo o el diálogo de duplicados. */
  async function runCommit(duplicateStrategy: DuplicateStrategy) {
    if (!preview) return;

    setDuplicatesOpen(false);
    setStep("committing");
    setError(null);

    const commit = await commitImportAction({
      brokerCode,
      fileName: preview.fileName,
      fileHash: preview.fileHash,
      portfolioId: portfolioId || undefined,
      brokerAccountId: brokerAccountId || undefined,
      rows: commitRows,
      duplicateStrategy,
    });

    if (!commit.ok) {
      setError(commit.error);
      setStep("review");
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
        ? "No se importó ningún movimiento nuevo"
        : `Importadas ${commit.imported} transacciones${commit.skipped > 0 ? ` (${commit.skipped} omitidas)` : ""}`
    );
    router.refresh();
  }

  function handleClose(nextOpen: boolean) {
    if (step === "committing") return;
    onOpenChange(nextOpen);
    if (!nextOpen) {
      const wasDone = step === "done";
      resetFile();
      if (wasDone) router.push("/imports");
    }
  }

  const isBusy = step === "committing" || checkingDuplicates;

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent
          className={
            editing
              ? "max-h-[92vh] max-w-[min(96vw,1400px)] overflow-y-auto"
              : "max-h-[90vh] max-w-3xl overflow-y-auto sm:max-w-4xl"
          }
        >
          <DialogHeader>
            <DialogTitle>Importar movimientos</DialogTitle>
            <DialogDescription>
              {editing
                ? "Corregí o excluí filas antes de guardar. Los cambios solo afectan a este import."
                : "Subí el export .xlsx de tu broker. Revisá la vista previa antes de guardar en la base de datos."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {step === "upload" && (
              <div className="space-y-2">
                <Label>Broker</Label>
                <Select
                  value={brokerCode}
                  onValueChange={(v) => {
                    const code = v as BrokerImportCode;
                    setBrokerCode(code);
                    setBrokerAccountId(
                      context.brokerAccounts.find((a) => a.broker.code === code)?.id ?? ""
                    );
                    resetFile();
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BROKER_IMPORTERS.map((b) => (
                      <SelectItem key={b.code} value={b.code} disabled={!b.enabled}>
                        {b.label}
                        {!b.enabled ? " (próximamente)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {step === "upload" && (
              <div className="space-y-3">
                <FileDropzone
                  accept={brokerOption?.accept ?? ".xlsx"}
                  disabled={!brokerOption?.enabled || parsing}
                  onFile={handleFile}
                />
                {parsing && (
                  <div className="space-y-2">
                    <p className="flex items-center gap-2 text-sm text-zinc-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Procesando archivo…
                    </p>
                    <IndeterminateBar />
                  </div>
                )}
              </div>
            )}

            {step === "review" && preview && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-zinc-400">
                    Archivo: <span className="text-zinc-200">{preview.fileName}</span>
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={resetFile}
                  >
                    Cambiar archivo
                  </Button>
                </div>

                {(context.portfolios.length > 0 || accountsForBroker.length > 0) && (
                  <PortfolioAccountSelect
                    context={context}
                    accountsForBroker={accountsForBroker}
                    portfolioId={portfolioId}
                    setPortfolioId={setPortfolioId}
                    brokerAccountId={brokerAccountId}
                    setBrokerAccountId={setBrokerAccountId}
                  />
                )}

                {editing ? (
                  <ImportEditTable
                    rows={rows}
                    excluded={excluded}
                    onToggleRow={handleToggleRow}
                    onSetExcluded={handleSetExcluded}
                    onPatchRow={handlePatchRow}
                    onResetRow={handleResetRow}
                  />
                ) : (
                  <ImportPreviewTable
                    preview={preview}
                    rows={rows}
                    excluded={excluded}
                  />
                )}
              </div>
            )}

            {step === "committing" && (
              <div className="space-y-3 py-2">
                <p className="flex items-center gap-2 text-sm text-zinc-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando {commitRows.length} movimientos…
                </p>
                <IndeterminateBar />
                <p className="text-xs text-zinc-500">
                  No cierres esta ventana. Se guarda todo o nada, así que si algo falla no queda
                  nada a medias.
                </p>
              </div>
            )}

            {step === "done" && result && (
              <div className="space-y-2 rounded-md border border-emerald-900/50 bg-emerald-950/20 p-4 text-sm">
                <p className="font-medium text-emerald-300">Importación completada.</p>
                <ul className="space-y-0.5 text-xs text-emerald-100/80">
                  <li>· {result.imported} movimientos guardados</li>
                  {result.skipped > 0 && <li>· {result.skipped} omitidos por duplicados</li>}
                  {result.duplicatesImported > 0 && (
                    <li>· {result.duplicatesImported} importados pese a estar repetidos</li>
                  )}
                  {stats.excluded > 0 && <li>· {stats.excluded} excluidos manualmente</li>}
                  {stats.edited > 0 && <li>· {stats.edited} corregidos a mano</li>}
                </ul>
              </div>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={isBusy}
            >
              {step === "done" ? "Cerrar" : "Cancelar"}
            </Button>

            {step === "review" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing((v) => !v)}
                  disabled={isBusy}
                >
                  {editing ? (
                    <>
                      <ListChecks className="mr-2 h-4 w-4" />
                      Ver resumen
                    </>
                  ) : (
                    <>
                      <Pencil className="mr-2 h-4 w-4" />
                      Editar
                      {stats.invalid > 0 ? ` (${stats.invalid})` : ""}
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleImportClick()}
                  disabled={!canCommit || isBusy}
                >
                  {checkingDuplicates ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verificando…
                    </>
                  ) : (
                    `Importar ${commitRows.length} movimientos`
                  )}
                </Button>
              </>
            )}

            {step === "committing" && (
              <Button type="button" disabled>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportDuplicatesDialog
        open={duplicatesOpen}
        onOpenChange={setDuplicatesOpen}
        result={duplicates}
        pending={step === "committing"}
        onConfirm={(strategy) => void runCommit(strategy)}
      />
    </>
  );
}

function IndeterminateBar() {
  return (
    <div
      role="progressbar"
      aria-label="Progreso indeterminado"
      className="indeterminate-bar relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800"
    />
  );
}

function PortfolioAccountSelect({
  context,
  accountsForBroker,
  portfolioId,
  setPortfolioId,
  brokerAccountId,
  setBrokerAccountId,
}: {
  context: ImportContextData;
  accountsForBroker: ImportContextData["brokerAccounts"];
  portfolioId: string;
  setPortfolioId: (id: string) => void;
  brokerAccountId: string;
  setBrokerAccountId: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {context.portfolios.length > 0 && (
        <div className="space-y-2">
          <Label>Portfolio</Label>
          <Select value={portfolioId} onValueChange={setPortfolioId}>
            <SelectTrigger>
              <SelectValue placeholder="Elegí portfolio" />
            </SelectTrigger>
            <SelectContent>
              {context.portfolios.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {accountsForBroker.length > 0 && (
        <div className="space-y-2">
          <Label>Cuenta</Label>
          <Select value={brokerAccountId} onValueChange={setBrokerAccountId}>
            <SelectTrigger>
              <SelectValue placeholder="Elegí cuenta" />
            </SelectTrigger>
            <SelectContent>
              {accountsForBroker.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} ({a.currencyCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
