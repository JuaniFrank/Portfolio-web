"use client";

import * as React from "react";
import {
  Activity,
  AlertCircle,
  CandlestickChart,
  CheckCircle2,
  CloudDownload,
  Info,
  LineChart,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getMonitoringSeriesAction,
  loadMonitoringHistoryAction,
} from "@/app/actions/monitoreo";
import type {
  MonitoringBootstrapData,
  MonitoringChartType,
  MonitoringCurrency,
  MonitoringRange,
  MonitoringSeries,
  MonitoringSeriesKind,
} from "@/lib/monitoreo/types";
import { AssetSelector } from "./asset-selector";
import { formatCurrency, formatPercent, formatTradingDate } from "./format";
import { MonitoringChart } from "./monitoring-chart";

interface MonitoreoPageProps {
  initialData: MonitoringBootstrapData;
}

export function MonitoreoPage({ initialData }: MonitoreoPageProps) {
  const { instruments, selectedInstrumentId: initialSelectedId, initialSeries } = initialData;

  const [selectedId, setSelectedId] = React.useState<string | null>(initialSelectedId);
  const [series, setSeries] = React.useState<MonitoringSeries | null>(initialSeries);

  const selectedInstrument = React.useMemo(
    () => instruments.find((i) => i.id === selectedId) || null,
    [instruments, selectedId]
  );

  const [currency, setCurrency] = React.useState<MonitoringCurrency>(
    initialSeries?.currency ?? (selectedInstrument?.isCedear ? "USD" : "ARS")
  );
  const [range, setRange] = React.useState<MonitoringRange>("ALL");
  const [chartType, setChartType] = React.useState<MonitoringChartType>("line");
  const [kind, setKind] = React.useState<MonitoringSeriesKind>(
    initialSeries?.kind ?? (selectedInstrument?.isCedear ? "cedear-underlying" : "native")
  );

  const [isPending, startTransition] = React.useTransition();
  const [isLoadingHistory, setIsLoadingHistory] = React.useState(false);

  // Fetch series on parameter changes
  const fetchSeries = React.useCallback(
    (
      instId: string,
      targetCurrency: MonitoringCurrency,
      targetRange: MonitoringRange,
      targetChartType: MonitoringChartType,
      targetKind: MonitoringSeriesKind
    ) => {
      startTransition(async () => {
        const res = await getMonitoringSeriesAction({
          instrumentId: instId,
          currency: targetCurrency,
          range: targetRange,
          chartType: targetChartType,
          kind: targetKind,
        });

        if ("error" in res) {
          toast.error(res.error);
        } else {
          setSeries(res);
        }
      });
    },
    []
  );

  // Handle instrument selection
  const handleSelectInstrument = (id: string) => {
    const inst = instruments.find((i) => i.id === id);
    if (!inst) return;

    setSelectedId(id);
    const newKind: MonitoringSeriesKind = inst.isCedear ? "cedear-underlying" : "native";
    const newCurrency: MonitoringCurrency = inst.isCedear ? "USD" : "ARS";

    setKind(newKind);
    setCurrency(newCurrency);

    fetchSeries(id, newCurrency, range, chartType, newKind);
  };

  // Handle CEDEAR mode toggle
  const handleToggleCedearMode = (targetKind: MonitoringSeriesKind) => {
    if (!selectedId) return;
    const targetCurrency: MonitoringCurrency =
      targetKind === "cedear-underlying" ? "USD" : "ARS";

    setKind(targetKind);
    setCurrency(targetCurrency);
    fetchSeries(selectedId, targetCurrency, range, chartType, targetKind);
  };

  // Handle range change
  const handleRangeChange = (newRange: MonitoringRange) => {
    if (!selectedId) return;
    setRange(newRange);
    fetchSeries(selectedId, currency, newRange, chartType, kind);
  };

  // Handle chart type toggle
  const handleChartTypeChange = (newType: MonitoringChartType) => {
    setChartType(newType);
    if (series) {
      setSeries({ ...series, chartType: newType });
    }
  };

  // Handle Load Full History action
  const handleLoadHistory = async () => {
    if (!selectedId || isLoadingHistory) return;

    setIsLoadingHistory(true);
    try {
      const res = await loadMonitoringHistoryAction({
        instrumentId: selectedId,
        currency,
        range,
        chartType,
        kind,
      });

      if ("error" in res) {
        toast.error(res.error);
      } else {
        setSeries(res);
        toast.success(`Histórico cargado (${res.bars.length} ruedas)`);
      }
    } catch {
      toast.error("Error al cargar el histórico");
    } finally {
      setIsLoadingHistory(false);
    }
  };

  if (instruments.length === 0) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center p-6 text-center">
        <Activity className="h-12 w-12 text-zinc-600 mb-4" />
        <h2 className="text-xl font-semibold text-zinc-100">Sin catálogo de activos disponible</h2>
        <p className="mt-2 text-sm text-zinc-400 max-w-md">
          No se encontraron instrumentos BYMA activos sincronizados. Ejecutá la sincronización de
          catálogo para habilitar el monitoreo.
        </p>
      </div>
    );
  }

  const historyStatus = series?.historyStatus ?? "not-requested";
  const isCedear = selectedInstrument?.isCedear ?? false;

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Monitoreo de Mercado</h1>
          <p className="text-sm text-zinc-400">
            Análisis técnico OHLCV y cotizaciones en tiempo real del catálogo BYMA
          </p>
        </div>

        {/* Global Controls: Asset Selector */}
        <div className="flex items-center gap-3">
          <AssetSelector
            instruments={instruments}
            selectedId={selectedId}
            onSelect={handleSelectInstrument}
            disabled={isPending}
          />
        </div>
      </div>

      {/* Main Analysis Card */}
      <Card className="border-zinc-800 bg-zinc-950/70 shadow-sm backdrop-blur">
        <CardHeader className="border-b border-zinc-800/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            {/* Asset Title & Modes */}
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg font-bold text-zinc-100">
                  {selectedInstrument?.ticker}
                  <span className="text-sm font-normal text-zinc-400">
                    — {selectedInstrument?.name}
                  </span>
                </CardTitle>
                <CardDescription className="text-xs text-zinc-500">
                  {selectedInstrument?.type === "CEDEAR" ? (
                    <>
                      CEDEAR BYMA • Subyacente:{" "}
                      <span className="font-mono text-zinc-300">
                        {selectedInstrument.underlyingTicker || "—"}
                      </span>
                    </>
                  ) : (
                    "Acción Local BYMA"
                  )}
                </CardDescription>
              </div>

              {/* CEDEAR Currency Switcher */}
              {isCedear && (
                <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => handleToggleCedearMode("cedear-underlying")}
                    disabled={isPending}
                    className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                      kind === "cedear-underlying"
                        ? "bg-zinc-800 text-zinc-50 shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    USD subyacente
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleCedearMode("native")}
                    disabled={isPending}
                    className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                      kind === "native"
                        ? "bg-zinc-800 text-zinc-50 shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    ARS CEDEAR
                  </button>
                </div>
              )}
            </div>

            {/* Range, Chart Type & History Action Controls */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Range Buttons */}
              <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs">
                {(["1M", "3M", "6M", "1Y", "ALL"] as MonitoringRange[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleRangeChange(r)}
                    disabled={isPending}
                    className={`rounded-md px-2 py-1 font-medium transition-colors ${
                      range === r
                        ? "bg-teal-950 text-teal-300 border border-teal-800/60 shadow-sm"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {/* Chart Type Toggle */}
              <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs">
                <button
                  type="button"
                  title="Gráfico de Línea"
                  onClick={() => handleChartTypeChange("line")}
                  className={`rounded-md p-1.5 transition-colors ${
                    chartType === "line"
                      ? "bg-zinc-800 text-teal-400"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <LineChart className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Gráfico de Velas Japonesas"
                  onClick={() => handleChartTypeChange("candles")}
                  className={`rounded-md p-1.5 transition-colors ${
                    chartType === "candles"
                      ? "bg-zinc-800 text-teal-400"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <CandlestickChart className="h-4 w-4" />
                </button>
              </div>

              {/* Cargar Histórico Button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLoadHistory}
                disabled={
                  isLoadingHistory ||
                  isPending ||
                  historyStatus === "loaded" ||
                  historyStatus === "unavailable"
                }
                className="h-8 border-zinc-700 bg-zinc-900 text-xs text-zinc-100 hover:bg-zinc-800"
              >
                {isLoadingHistory ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin text-teal-400" />
                    Cargando...
                  </>
                ) : historyStatus === "loaded" ? (
                  <>
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />
                    Histórico disponible
                  </>
                ) : historyStatus === "unavailable" ? (
                  <>
                    <AlertCircle className="mr-1.5 h-3.5 w-3.5 text-zinc-500" />
                    Sin cobertura
                  </>
                ) : (
                  <>
                    <CloudDownload className="mr-1.5 h-3.5 w-3.5 text-teal-400" />
                    Cargar histórico
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4">
          {/* Status Notices */}
          {historyStatus === "live-fallback" && (
            <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              <Info className="h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Mostrando cotización instantánea live de Data912. Hacé clic en{" "}
                <strong>Cargar histórico</strong> para consultar y visualizar la serie histórica completa.
              </span>
            </div>
          )}

          {series?.dataQuality.warning && (
            <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
              <Info className="h-4 w-4 shrink-0 text-zinc-400" />
              <span>{series.dataQuality.warning}</span>
            </div>
          )}

          {/* Chart View */}
          {isPending ? (
            <div className="flex h-[420px] w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/40">
              <div className="flex flex-col items-center gap-2 text-zinc-400">
                <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
                <span className="text-xs">Actualizando serie de mercado...</span>
              </div>
            </div>
          ) : (
            <MonitoringChart
              bars={series?.bars ?? []}
              chartType={chartType}
              currency={currency}
              ticker={selectedInstrument?.ticker ?? "—"}
              height={440}
            />
          )}

          {/* Metadata Footer */}
          {series && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800/60 pt-3 text-xs text-zinc-500">
              <div className="flex flex-wrap items-center gap-4">
                <div>
                  <span>Proveedor: </span>
                  <strong className="text-zinc-300 uppercase">{series.provider}</strong>
                </div>
                <div>
                  <span>Source: </span>
                  <strong className="text-zinc-300 font-mono">{series.source}</strong>
                </div>
                <div>
                  <span>Ajuste: </span>
                  <strong className="text-zinc-300">{series.adjustmentPolicy}</strong>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div>
                  <span>Rango cubierto: </span>
                  <strong className="text-zinc-300">
                    {formatTradingDate(series.firstDate)} — {formatTradingDate(series.lastDate)}
                  </strong>
                </div>
                <div>
                  <span>Ruedas: </span>
                  <strong className="text-zinc-300 font-mono">{series.bars.length}</strong>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
