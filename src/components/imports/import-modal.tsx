"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { commitImportAction, type ImportContextData } from "@/app/actions/imports";
import { FileDropzone } from "@/components/imports/file-dropzone";
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
import { parseImportFile } from "@/lib/importers/parse-workbook";
import { BROKER_IMPORTERS } from "@/lib/importers/registry";
import type {
  BrokerImportCode,
  CommitImportRow,
  ImportPreviewSummary,
} from "@/lib/importers/types";

type Step = "upload" | "preview" | "committing" | "done";

type ImportModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: ImportContextData;
};

export function ImportModal({ open, onOpenChange, context }: ImportModalProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [brokerCode, setBrokerCode] = useState<BrokerImportCode>("BALANZ");
  const [preview, setPreview] = useState<ImportPreviewSummary | null>(null);
  const [parsing, setParsing] = useState(false);
  const [portfolioId, setPortfolioId] = useState("");
  const [brokerAccountId, setBrokerAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const brokerOption = BROKER_IMPORTERS.find((b) => b.code === brokerCode);
  const dbBroker = context.brokers.find((b) => b.code === brokerCode);

  const accountsForBroker = useMemo(
    () => context.brokerAccounts.filter((a) => a.broker.code === brokerCode),
    [context.brokerAccounts, brokerCode]
  );

  useEffect(() => {
    if (!open) {
      setStep("upload");
      setPreview(null);
      setParsing(false);
      setError(null);
      return;
    }

    const defaultPortfolio = context.portfolios.find((p) => p.isDefault) ?? context.portfolios[0];
    if (defaultPortfolio) setPortfolioId(defaultPortfolio.id);

    const defaultAccount = accountsForBroker[0];
    if (defaultAccount) setBrokerAccountId(defaultAccount.id);
  }, [open, context.portfolios, accountsForBroker]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!brokerOption?.enabled) return;

      setParsing(true);
      setError(null);
      try {
        const result = await parseImportFile(brokerCode, file);
        if (result.rows.length === 0) {
          setError("El archivo no contiene movimientos.");
          setPreview(null);
          return;
        }
        setPreview(result);
        setStep("preview");
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

  const commitRows: CommitImportRow[] = useMemo(() => {
    if (!preview) return [];
    return preview.rows
      .filter((r) => r.status !== "invalid" && r.parsed)
      .map((r) => ({
        rowNumber: r.rowNumber,
        status: r.status,
        parsed: r.parsed!,
      }));
  }, [preview]);

  const canCommit = Boolean(preview) && commitRows.length > 0 && Boolean(dbBroker?.enabled);

  async function handleCommit() {
    if (!preview || !canCommit) return;

    setStep("committing");
    setError(null);

    const result = await commitImportAction({
      brokerCode,
      fileName: preview.fileName,
      fileHash: preview.fileHash,
      portfolioId: portfolioId || undefined,
      brokerAccountId: brokerAccountId || undefined,
      rows: commitRows,
    });

    if (!result.ok) {
      setError(result.error);
      setStep("preview");
      toast.error(result.error);
      return;
    }

    setStep("done");
    toast.success(`Importadas ${result.imported} transacciones (${result.skipped} omitidas)`);
    router.refresh();
  }

  function handleClose(nextOpen: boolean) {
    if (step === "committing") return;
    onOpenChange(nextOpen);
    if (!nextOpen && step === "done") {
      router.push("/imports");
    }
  }

  const isCommitting = step === "committing";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar movimientos</DialogTitle>
          <DialogDescription>
            Subí el export .xlsx de tu broker. Revisá la vista previa antes de guardar en la base de
            datos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Broker</Label>
            <Select
              value={brokerCode}
              onValueChange={(v) => {
                setBrokerCode(v as BrokerImportCode);
                setPreview(null);
                setStep("upload");
                setError(null);
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

          {step === "upload" && (
            <div className="space-y-3">
              <FileDropzone
                accept={brokerOption?.accept ?? ".xlsx"}
                disabled={!brokerOption?.enabled || parsing}
                onFile={handleFile}
              />
              {parsing && (
                <p className="flex items-center gap-2 text-sm text-zinc-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Procesando archivo…
                </p>
              )}
            </div>
          )}

          {step === "preview" && preview && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">
                Archivo: <span className="text-zinc-200">{preview.fileName}</span>
              </p>

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

              <ImportPreviewTable preview={preview} />

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStep("upload");
                  setPreview(null);
                }}
              >
                Cambiar archivo
              </Button>
            </div>
          )}

          {step === "done" && preview && (
            <p className="text-sm text-emerald-400">
              Importación completada. Podés ver las transacciones en el listado.
            </p>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={isCommitting}
          >
            {step === "done" ? "Cerrar" : "Cancelar"}
          </Button>
          {step === "preview" && (
            <Button type="button" onClick={handleCommit} disabled={!canCommit || isCommitting}>
              {isCommitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando…
                </>
              ) : (
                `Importar ${commitRows.length} movimientos`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
