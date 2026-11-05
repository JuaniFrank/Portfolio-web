"use client";

import * as React from "react";
import {
  Activity,
  AlertCircle,
  CandlestickChart,
  Info,
  LineChart,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchSeries, fetchTrades, postHistory } from "@/lib/monitoreo/activos-client";
import { EMPTY_TRADE_MARKER_DATA, type TradeMarkerData } from "@/lib/monitoreo/trade-marker-data";
import {
  buildActivosSearch,
  sortInstrumentsPortfolioFirst,
} from "@/lib/monitoreo/activos-selection";
import { buildHeaderStats } from "@/lib/monitoreo/asset-stats";
import { drawingsStorageKey } from "@/lib/monitoreo/drawings-storage";
import { useStoredBoolean } from "@/lib/ui/use-stored-boolean";
import { shouldLoadHistory } from "@/lib/monitoreo/history-policy";
import { filterBarsByRangeFromLast } from "@/lib/monitoreo/series";
import { isSeriesAdjusted } from "@/lib/monitoreo/trade-projection";
import {
  buildPositionSummary,
  buildTradeEntries,
  type TradeEntry,
  type TradeMarker,
} from "@/lib/monitoreo/trade-markers";
import type {
  MonitoringBootstrapData,
  MonitoringChartType,
  MonitoringCurrency,
  MonitoringRange,
  MonitoringSeries,
  UiMonitoringSeriesKind,
} from "@/lib/monitoreo/types";
import { AssetHeaderStats } from "./asset-header-stats";
import { AssetSelector } from "./asset-selector";
import { formatTradingDate } from "./format";
import type { ChartFocusRequest } from "./kline-chart";
import { PositionPanel } from "./position-panel";
import { TradesList } from "./trades-list";

// klinecharts is heavy and only paints once a series is loaded: code-split it (client-only).
const KLineChart = dynamic(() => import("./kline-chart").then((m) => m.KLineChart), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[320px] w-full" />,
});

const RANGES: MonitoringRange[] = ["1M", "3M", "6M", "1Y", "ALL"];

interface MonitoreoPageProps {
  initialData: MonitoringBootstrapData;
}

function currencyForKind(kind: UiMonitoringSeriesKind): MonitoringCurrency {
  return kind === "cedear-underlying" ? "USD" : "ARS";
}

const seriesKey = (instrumentId: string, kind: UiMonitoringSeriesKind) => `${instrumentId}:${kind}`;

export function MonitoreoPage({ initialData }: MonitoreoPageProps) {
  const {
    instruments,
    selectedInstrumentId: initialSelectedId,
    selectedKind: initialKind,
    initialSeries,
  } = initialData;
  const pathname = usePathname();

  const sortedInstruments = React.useMemo(
    () => sortInstrumentsPortfolioFirst(instruments),
    [instruments]
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(initialSelectedId);
  // Always the FULL series ("ALL"); the displayed range is derived client-side below.
  const [series, setSeries] = React.useState<MonitoringSeries | null>(initialSeries);

  const selectedInstrument = React.useMemo(
    () => instruments.find((i) => i.id === selectedId) || null,
    [instruments, selectedId]
  );

  const [kind, setKind] = React.useState<UiMonitoringSeriesKind>(initialKind);
  const currency = currencyForKind(kind);
  const [range, setRange] = React.useState<MonitoringRange>("ALL");
  const [chartType, setChartType] = React.useState<MonitoringChartType>("candles");
  const [tradesCollapsed, setTradesCollapsed] = useStoredBoolean("activos:trades-collapsed", false);

  const [isPending, startTransition] = React.useTransition();
  // Latest-wins guard for the cached-series fetch triggered by selection changes.
  const seriesRequestRef = React.useRef(0);
  // Series that already got their full history this session, and keys with a request in flight.
  const loadedSeriesRef = React.useRef(new Map<string, MonitoringSeries>());
  const requestedHistoryRef = React.useRef(new Set<string>());
  const [failedHistoryKeys, setFailedHistoryKeys] = React.useState<ReadonlySet<string>>(new Set());
  const [todayIso] = React.useState(() => new Date().toISOString().slice(0, 10));

  // Trades + corporate event dates for the selected instrument, feeding markers and position.
  const [tradeData, setTradeData] = React.useState<TradeMarkerData | null>(null);
  // Marker highlighted from the chart or the trades list, and the list's "scroll to" request.
  const [activeMarkerId, setActiveMarkerId] = React.useState<string | null>(null);
  const [focusRequest, setFocusRequest] = React.useState<ChartFocusRequest | null>(null);

  // Reset stale per-instrument state synchronously when the instrument changes, before the fetch
  // effect below resolves — "adjusting state during render" (see React docs), not a
  // setState-in-effect, so a different instrument's markers never briefly render against the
  // new one's bars.
  const [tradeDataInstrumentId, setTradeDataInstrumentId] = React.useState(selectedId);
  if (selectedId !== tradeDataInstrumentId) {
    setTradeDataInstrumentId(selectedId);
    setTradeData(null);
    setActiveMarkerId(null);
    setFocusRequest(null);
  }

  React.useEffect(() => {
    if (!selectedId) return;

    let cancelled = false;
    // Degrades to "no trades" on any failure (fetchTrades never throws).
    fetchTrades(selectedId).then((res) => {
      if (cancelled) return;
      setTradeData("error" in res ? EMPTY_TRADE_MARKER_DATA : res);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  // The series is only usable when it belongs to the current selection (a switch is in flight
  // otherwise, and the previous instrument's bars must not render against the new one).
  const activeSeries =
    series && series.instrumentId === selectedId && series.kind === kind ? series : null;
  const historyKey = selectedId ? seriesKey(selectedId, kind) : "";
  const needsHistory = activeSeries !== null && shouldLoadHistory(activeSeries, todayIso);
  const historyLoading = needsHistory && !failedHistoryKeys.has(historyKey);

  // Auto history: the cached series renders immediately; when its coverage is insufficient the
  // full history loads in the background (once per instrument+kind per page session).
  React.useEffect(() => {
    if (!needsHistory || !selectedId) return;
    const requested = requestedHistoryRef.current;
    if (requested.has(historyKey)) return;
    requested.add(historyKey);

    let cancelled = false;
    let settled = false;

    postHistory({
      instrumentId: selectedId,
      currency: currencyForKind(kind),
      range: "ALL",
      chartType: "candles",
      kind,
    }).then((res) => {
      if (cancelled) return; // the user switched instrument meanwhile
      settled = true;
      if ("error" in res) {
        setFailedHistoryKeys((prev) => new Set(prev).add(historyKey));
        return;
      }
      loadedSeriesRef.current.set(historyKey, res);
      setSeries(res);
    });

    return () => {
      cancelled = true;
      // An aborted request may be retried when the user comes back to this instrument.
      if (!settled) requested.delete(historyKey);
    };
  }, [needsHistory, historyKey, selectedId, kind]);

  const displayedBars = React.useMemo(
    () => (activeSeries ? filterBarsByRangeFromLast(activeSeries.bars, range) : []),
    [activeSeries, range]
  );

  const projectionContext = React.useMemo(
    () =>
      activeSeries && tradeData
        ? {
            kind: activeSeries.kind,
            currency: activeSeries.currency,
            nativeArsCloses: tradeData.nativeArsCloses,
            cclByDate: tradeData.cclByDate,
            seriesAdjusted: isSeriesAdjusted(activeSeries),
            corporateEventDates: tradeData.corporateEventDates,
          }
        : null,
    [activeSeries, tradeData]
  );

  // Every trade against the FULL bars (feeds the list, including trades with no bar to anchor
  // to); the chart only gets the anchored ones inside the displayed range.
  const tradeEntries: TradeEntry[] = React.useMemo(() => {
    if (!activeSeries || !tradeData || !projectionContext) return [];
    return buildTradeEntries(
      tradeData.trades,
      activeSeries.bars,
      projectionContext,
      tradeData.corporateEventDates
    );
  }, [activeSeries, tradeData, projectionContext]);

  const chartMarkers = React.useMemo(() => {
    const first = displayedBars[0];
    if (!first) return [];
    return tradeEntries.filter(
      (e): e is TradeMarker => e.barTime !== null && e.barTime >= first.time
    );
  }, [tradeEntries, displayedBars]);

  // Reuses the projection already done for `tradeEntries` (same full bars and context).
  const position = React.useMemo(() => {
    if (!activeSeries || !tradeData) return null;
    if (tradeEntries.length === 0 || activeSeries.bars.length === 0) return null;
    const lastClose = activeSeries.bars[activeSeries.bars.length - 1]!.close;
    return buildPositionSummary(
      tradeEntries.map((e) => ({
        side: e.side,
        quantity: e.trade.quantity,
        chartPrice: e.chartPrice,
        tradeDate: e.trade.tradeDate,
      })),
      lastClose,
      tradeData.corporateEventDates
    );
  }, [activeSeries, tradeData, tradeEntries]);

  const headerStats = React.useMemo(
    () => buildHeaderStats(activeSeries?.bars ?? [], displayedBars),
    [activeSeries, displayedBars]
  );

  const syncUrl = (instrumentId: string, nextKind: UiMonitoringSeriesKind) => {
    const inst = instruments.find((i) => i.id === instrumentId);
    if (!inst) return;
    // Documented integration (docs 04-linking-and-navigating.md, "Using the native History API"):
    // Next patches `replaceState`/`pushState` and syncs `usePathname`/`useSearchParams`. Data is
    // fetched through route handlers, not server actions, so the router's RESTORE for this call
    // has no queued action to orphan, and the saved history entry stays correct for Back.
    window.history.replaceState(
      null,
      "",
      `${pathname}${buildActivosSearch(inst.ticker, nextKind, inst.isCedear)}`
    );
  };

  // Show the (already loaded or cached) series of an instrument+kind. Full histories fetched
  // earlier this session are reused as-is; otherwise the server returns the cached series.
  const showSeries = (instrumentId: string, nextKind: UiMonitoringSeriesKind) => {
    const requestId = ++seriesRequestRef.current;
    const loaded = loadedSeriesRef.current.get(seriesKey(instrumentId, nextKind));
    if (loaded) {
      setSeries(loaded);
      return;
    }

    startTransition(async () => {
      const res = await fetchSeries({
        instrumentId,
        currency: currencyForKind(nextKind),
        range: "ALL",
        chartType: "candles",
        kind: nextKind,
      });
      if (requestId !== seriesRequestRef.current) return; // a newer selection superseded this one

      if ("error" in res) {
        toast.error(res.error);
      } else {
        setSeries(res);
      }
    });
  };

  const handleSelectInstrument = (id: string) => {
    const inst = instruments.find((i) => i.id === id);
    if (!inst) return;
    const nextKind: UiMonitoringSeriesKind = inst.isCedear ? "cedear-underlying" : "native";

    setSelectedId(id);
    setKind(nextKind);
    showSeries(id, nextKind);
    syncUrl(id, nextKind);
  };

  const handleToggleCedearMode = (targetKind: UiMonitoringSeriesKind) => {
    if (!selectedId || targetKind === kind) return;
    setKind(targetKind);
    showSeries(selectedId, targetKind);
    syncUrl(selectedId, targetKind);
  };

  const handleSelectTrade = (id: string) => {
    setActiveMarkerId(id);
    // A trade older than the selected range has no marker on the chart: widen the range first.
    if (!chartMarkers.some((m) => m.id === id)) setRange("ALL");
    setFocusRequest((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
  };

  // Range shortcuts: 1 / 3 / 6 / Y / A (ignored while typing or with modifiers).
  React.useEffect(() => {
    const byKey: Record<string, MonitoringRange> = { "1": "1M", "3": "3M", "6": "6M", y: "1Y", a: "ALL" };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const next = byKey[event.key.toLowerCase()];
      if (next) setRange(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (instruments.length === 0) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center p-6 text-center">
        <Activity className="h-12 w-12 text-zinc-600 mb-4" />
        <h2 className="text-xl font-semibold text-zinc-100">Sin catálogo de activos disponible</h2>
        <p className="mt-2 text-sm text-zinc-400 max-w-md">
          No se encontraron instrumentos BYMA activos sincronizados. Ejecutá la sincronización de
          catálogo para habilitar esta sección.
        </p>
      </div>
    );
  }

  const isCedear = selectedInstrument?.isCedear ?? false;
  const scaleLabel = kind === "cedear-underlying" ? "Equivalente subyacente" : "Equivalente en el gráfico";
  const showTradesList = tradeEntries.length > 0;
  const tradesVisible = showTradesList && !tradesCollapsed;
  const unavailable = activeSeries?.historyStatus === "unavailable" || failedHistoryKeys.has(historyKey);

  const segmentButton = (active: boolean) =>
    `rounded-md px-2.5 py-1 font-medium transition-colors ${
      active ? "bg-zinc-800 text-zinc-50 shadow-sm" : "text-zinc-400 hover:text-zinc-200"
    }`;

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100dvh-6.5rem)] lg:min-h-[560px]">
      {/* Compact toolbar: title, selector, asset info, modes, range, chart type */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-lg font-bold tracking-tight text-zinc-100">Activos</h1>
        <AssetSelector
          instruments={sortedInstruments}
          selectedId={selectedId}
          onSelect={handleSelectInstrument}
          disabled={isPending}
        />

        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-zinc-100">
            {selectedInstrument?.ticker}
            <span className="ml-2 font-normal text-zinc-400">{selectedInstrument?.name}</span>
          </p>
          <p className="truncate text-[11px] text-zinc-500">
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
          </p>
        </div>

        {isCedear && (
          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => handleToggleCedearMode("cedear-underlying")}
              disabled={isPending}
              className={segmentButton(kind === "cedear-underlying")}
            >
              USD subyacente
            </button>
            <button
              type="button"
              onClick={() => handleToggleCedearMode("native")}
              disabled={isPending}
              className={segmentButton(kind === "native")}
            >
              ARS CEDEAR
            </button>
          </div>
        )}

        {historyLoading && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-400">
            <Loader2 className="h-3 w-3 animate-spin text-teal-400" />
            Actualizando histórico…
          </span>
        )}
        {!historyLoading && unavailable && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-500">
            <AlertCircle className="h-3 w-3" />
            Sin histórico disponible
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div
            className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs"
            title="Atajos: 1, 3, 6, Y, A"
          >
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
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

          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs">
            <button
              type="button"
              title="Gráfico de Línea"
              onClick={() => setChartType("line")}
              className={`rounded-md p-1.5 transition-colors ${
                chartType === "line" ? "bg-zinc-800 text-teal-400" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <LineChart className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Gráfico de Velas Japonesas"
              onClick={() => setChartType("candles")}
              className={`rounded-md p-1.5 transition-colors ${
                chartType === "candles" ? "bg-zinc-800 text-teal-400" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <CandlestickChart className="h-4 w-4" />
            </button>
          </div>

          {showTradesList && (
            <button
              type="button"
              onClick={() => setTradesCollapsed(!tradesCollapsed)}
              aria-pressed={!tradesCollapsed}
              title={tradesCollapsed ? "Mostrar tus operaciones" : "Ocultar tus operaciones"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:text-zinc-100"
            >
              {tradesCollapsed ? (
                <PanelRightOpen className="h-4 w-4" />
              ) : (
                <PanelRightClose className="h-4 w-4" />
              )}
              Operaciones
            </button>
          )}
        </div>
      </div>

      {/* Stats strip */}
      {activeSeries && (
        <div className="flex flex-wrap gap-2">
          <AssetHeaderStats stats={headerStats} currency={currency} range={range} />
          {position && (
            <PositionPanel
              summary={position}
              tradesCount={tradeData?.trades.length ?? 0}
              currency={currency}
            />
          )}
        </div>
      )}

      {activeSeries?.dataQuality.warning && (
        <div className="flex items-center gap-2.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-400">
          <Info className="h-4 w-4 shrink-0 text-zinc-400" />
          <span>{activeSeries.dataQuality.warning}</span>
        </div>
      )}

      {/* Chart (fills the remaining viewport height on desktop) + trades list */}
      <div
        className={
          tradesVisible
            ? "grid min-h-0 gap-3 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)]"
            : "grid min-h-0 gap-3 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]"
        }
      >
        <div className="h-[520px] min-h-0 min-w-0 lg:h-auto">
          {isPending ? (
            <div className="flex h-full min-h-[320px] w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/40">
              <div className="flex flex-col items-center gap-2 text-zinc-400">
                <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
                <span className="text-xs">Cargando serie de mercado...</span>
              </div>
            </div>
          ) : displayedBars.length === 0 ? (
            <div className="flex h-full min-h-[320px] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 p-6 text-center">
              {historyLoading ? (
                <>
                  <Loader2 className="mb-2 h-6 w-6 animate-spin text-teal-500" />
                  <p className="text-sm font-medium text-zinc-300">Buscando el histórico…</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-zinc-300">
                    Sin precios disponibles para {selectedInstrument?.ticker}
                  </p>
                  <p className="max-w-sm text-xs text-zinc-500">
                    No encontramos cotizaciones para este activo
                    {isCedear && kind === "cedear-underlying" ? " en su versión subyacente" : ""}.
                    {isCedear ? " Probá con la otra vista o " : " Probá "}
                    con otro activo.
                  </p>
                </>
              )}
            </div>
          ) : (
            <KLineChart
              bars={displayedBars}
              chartType={chartType}
              currency={currency}
              ticker={selectedInstrument?.ticker ?? "—"}
              drawingsKey={drawingsStorageKey(selectedInstrument?.ticker ?? "", kind)}
              markers={chartMarkers}
              avgCost={position?.avgCost ?? null}
              activeMarkerId={activeMarkerId}
              onMarkerHover={setActiveMarkerId}
              focusRequest={focusRequest}
              scaleLabel={scaleLabel}
            />
          )}
        </div>

        {tradesVisible && (
          <div className="h-[320px] min-h-0 lg:h-auto">
            <TradesList
              entries={tradeEntries}
              chartCurrency={currency}
              scaleLabel={scaleLabel}
              activeId={activeMarkerId}
              onHover={setActiveMarkerId}
              onSelect={handleSelectTrade}
            />
          </div>
        )}
      </div>

      {/* Compact metadata */}
      {activeSeries && (
        <p className="truncate text-[11px] leading-relaxed text-zinc-500">
          Fuente: <span className="uppercase">{activeSeries.provider}</span> ·{" "}
          <span className="font-mono">{activeSeries.source}</span> · Ajuste:{" "}
          {activeSeries.adjustmentPolicy} · {formatTradingDate(activeSeries.firstDate)} —{" "}
          {formatTradingDate(activeSeries.lastDate)} · {activeSeries.bars.length} ruedas
        </p>
      )}
    </div>
  );
}
