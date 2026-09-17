"use client";

import { Loader2, ArrowRight } from "lucide-react";
import type { ImportContextData } from "@/app/actions/imports";
import { BrokerGuide } from "@/components/imports/broker-guide";
import { FileDropzone } from "@/components/imports/file-dropzone";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BROKER_IMPORTERS } from "@/lib/importers/registry";
import type { BrokerImportCode } from "@/lib/importers/types";

type ImportUploadStepProps = {
  context: ImportContextData;
  brokerCode: BrokerImportCode;
  onBrokerCodeChange: (code: BrokerImportCode) => void;
  portfolioId: string;
  onPortfolioIdChange: (id: string) => void;
  brokerAccountId: string;
  onBrokerAccountIdChange: (id: string) => void;
  parsing: boolean;
  onFile: (file: File) => void;
  error: string | null;
};

export function ImportUploadStep({
  context,
  brokerCode,
  onBrokerCodeChange,
  portfolioId,
  onPortfolioIdChange,
  brokerAccountId,
  onBrokerAccountIdChange,
  parsing,
  onFile,
  error,
}: ImportUploadStepProps) {
  const brokerOption = BROKER_IMPORTERS.find((b) => b.code === brokerCode);
  const accountsForBroker = context.brokerAccounts.filter(
    (a) => a.broker.code === brokerCode
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-100">
          Paso 1: Seleccioná el origen y tu archivo
        </h2>
        <p className="text-sm text-zinc-400">
          Elegí tu broker y el destino de las operaciones, y luego cargá el archivo exportado.
        </p>
      </div>

      {/* Selector de Broker y Cuentas */}
      <div className="grid gap-4 sm:grid-cols-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <div className="space-y-2">
          <Label className="text-xs font-medium text-zinc-300">Broker</Label>
          <Select
            value={brokerCode}
            onValueChange={(v) => {
              const code = v as BrokerImportCode;
              onBrokerCodeChange(code);
              const defaultAccount = context.brokerAccounts.find(
                (a) => a.broker.code === code
              )?.id;
              onBrokerAccountIdChange(defaultAccount ?? "");
            }}
          >
            <SelectTrigger className="h-9 text-xs">
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

        {context.portfolios.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs font-medium text-zinc-300">Portfolio destino</Label>
            <Select value={portfolioId} onValueChange={onPortfolioIdChange}>
              <SelectTrigger className="h-9 text-xs">
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

        <div className="space-y-2">
          <Label className="text-xs font-medium text-zinc-300">Cuenta en el broker</Label>
          <Select
            value={brokerAccountId}
            onValueChange={onBrokerAccountIdChange}
            disabled={accountsForBroker.length === 0}
          >
            <SelectTrigger className="h-9 text-xs">
              <SelectValue
                placeholder={
                  accountsForBroker.length === 0
                    ? "Se creará por defecto"
                    : "Elegí cuenta"
                }
              />
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
      </div>

      {/* Guía contextual para exportar */}
      <BrokerGuide brokerCode={brokerCode} />

      {/* Zona de Drop / Carga de Archivo */}
      <div className="space-y-3">
        <FileDropzone
          accept={brokerOption?.accept ?? ".xlsx"}
          disabled={!brokerOption?.enabled || parsing}
          onFile={onFile}
        />

        {parsing && (
          <div className="space-y-2 rounded-lg border border-teal-900/40 bg-teal-950/10 p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-teal-300">
              <Loader2 className="h-4 w-4 animate-spin text-teal-400" />
              Leyendo y normalizando operaciones del archivo…
            </p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-teal-500" />
            </div>
            <p className="text-xs text-zinc-400">
              Verificando consistencia de fechas, tickers, importes y divisas.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-xs text-red-300">
            <p className="font-semibold text-red-200">Error al procesar el archivo</p>
            <p className="mt-1">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
