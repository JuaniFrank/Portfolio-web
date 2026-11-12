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
import type { MarketQuote } from "@/lib/monitoreo/load-quote";
import {
  convertBasisPrice,
  defaultBasis,
  resolveBasisOptions,
  moneyFactor,
  toBasisPrice,
  type PriceBasis,
} from "@/lib/monitoreo/price-basis";
import { fetchQuote, fetchSeries, fetchTrades, postHistory } from "@/lib/monitoreo/activos-client";
import { EMPTY_TRADE_MARKER_DATA, type TradeMarkerData } from "@/lib/monitoreo/trade-marker-data";
import {
  buildActivosSearch,
  sortInstrumentsPortfolioFirst,
} from "@/lib/monitoreo/activos-selection";
import { buildHeaderStats } from "@/lib/monitoreo/asset-stats";
import {
  ghostMarkers,
  newDraft,
  parseDecimalInput,
  resolveDrafts,
  type OrderDraft,
} from "@/lib/monitoreo/order-drafts";
import { adrSymbolFor } from "@/lib/market/adr-map";
import { drawingsStorageKey } from "@/lib/monitoreo/drawings-storage";
import { useStoredBoolean } from "@/lib/ui/use-stored-boolean";
import { shouldLoadHistory } from "@/lib/monitoreo/history-policy";
import { filterBarsByRangeFromLast } from "@/lib/monitoreo/series";
import { isSeriesAdjusted } from "@/lib/monitoreo/trade-projection";
import { adjustmentPolicyLabel, resolveTradeAdjustment } from "@/lib/monitoreo/split-adjustment";
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
import { BuySimulator } from "./buy-simulator";
import { formatTradingDate } from "./format";
import type { ChartFocusRequest } from "./kline-chart";
import { PositionPanel } from "./position-panel";
import { OperationsColumn, type ColumnTab } from "./operations-column";
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
  return kind === "cedear-underlying" || kind === "adr" ? "USD" : "ARS";
}

const seriesKey = (instrumentId: string, kind: UiMonitoringSeriesKind, adjusted: boolean) =>
  `${instrumentId}:${kind}:${adjusted ? "adj" : "raw"}`;

export function MonitoreoPage({ initialData }: MonitoreoPageProps) {
  const {
    instruments,
    selectedInstrumentId: initialSelectedId,
    selectedKind: initialKind,
    initialSeries,
    splitAdjustmentEnabled,
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
  // "Ajustado / Sin ajustar": sent to the server, which ignores it when its switch is off.
  const [adjusted, setAdjusted] = React.useState(true);
  const [tradesCollapsed, setTradesCollapsed] = useStoredBoolean("activos:trades-collapsed", false);

  const [isPending, startTransition] = React.useTransition();
  // Latest-wins guard for the cached-series fetch triggered by selection changes.
  const seriesRequestRef = React.useRef(0);
  // Series that already got their full history this session, and keys with a request in flight.
  const loadedSeriesRef = React.useRef(new Map<string, MonitoringSeries>());
  const requestedHistoryRef = React.useRef(new Set<string>());
  const [failedHistoryKeys, setFailedHistoryKeys] = React.useState<ReadonlySet<string>>(new Set());

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
  const historyKey = selectedId ? seriesKey(selectedId, kind, adjusted) : "";
  const needsHistory = activeSeries !== null && shouldLoadHistory(activeSeries);
  const historyLoading = needsHistory && !failedHistoryKeys.has(historyKey);

  // Auto history: the cached series renders immediately and the full history (with today's bar)
  // loads in the background (once per instrument+kind per page session).
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
      adjusted,
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
  }, [needsHistory, historyKey, selectedId, kind, adjusted]);

  const displayedBars = React.useMemo(
    () => (activeSeries ? filterBarsByRangeFromLast(activeSeries.bars, range) : []),
    [activeSeries, range]
  );

  // Adjusted series (ours or the provider's): trade prices follow the bars' scale and a later
  // corporate event no longer blocks comparability. Raw series keep the legacy gating.
  const tradeAdjustment = React.useMemo(
    () => (activeSeries && tradeData ? resolveTradeAdjustment(activeSeries, tradeData) : null),
    [activeSeries, tradeData]
  );

  const projectionContext = React.useMemo(
    () =>
      activeSeries && tradeData && tradeAdjustment
        ? {
            kind: activeSeries.kind,
            currency: activeSeries.currency,
            nativeArsCloses: tradeData.nativeArsCloses,
            cclByDate: tradeData.cclByDate,
            seriesAdjusted: isSeriesAdjusted(activeSeries),
            corporateEventDates: tradeData.corporateEventDates,
            adjustmentEvents: tradeAdjustment.adjustmentEvents,
          }
        : null,
    [activeSeries, tradeData, tradeAdjustment]
  );

  // Every trade against the FULL bars (feeds the list, including trades with no bar to anchor
  // to); the chart only gets the anchored ones inside the displayed range.
  const tradeEntries: TradeEntry[] = React.useMemo(() => {
    if (!activeSeries || !tradeData || !projectionContext || !tradeAdjustment) return [];
    return buildTradeEntries(
      tradeData.trades,
      activeSeries.bars,
      projectionContext,
      tradeAdjustment.gatingEventDates
    );
  }, [activeSeries, tradeData, projectionContext, tradeAdjustment]);

  const chartMarkers = React.useMemo(() => {
    const first = displayedBars[0];
    if (!first) return [];
    return tradeEntries.filter(
      (e): e is TradeMarker => e.barTime !== null && e.barTime >= first.time
    );
  }, [tradeEntries, displayedBars]);

  // Reuses the projection already done for `tradeEntries` (same full bars and context).
  const position = React.useMemo(() => {
    if (!activeSeries || !tradeData || !tradeAdjustment) return null;
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
      // The ADR same-day factor takes both closes from the trade date, so later local
      // events do not break comparability.
      activeSeries.kind === "adr" ? [] : tradeAdjustment.gatingEventDates,
      // Trade prices are divided by later events only on native series: bring quantities along.
      activeSeries.kind === "native" ? tradeAdjustment.adjustmentEvents : undefined
    );
  }, [activeSeries, tradeData, tradeAdjustment, tradeEntries]);

  // Order simulator: ephemeral rows (never persisted). Prices and target PPCs are per unit in the
  // chosen basis (ARS local / USD counterpart) and convert to the chart scale with a live factor;
  // a row's price follows the basis' market quote until the user types one (`null`). Everything
  // resets when the instrument or series kind changes; only "Actualizar" overwrites typed prices.
  // The simulator lives in the trades column: opened once from its footer button, then reachable
  // through the "Simular" tab. State survives tab switches; hiding the column pauses it.
  const [simStarted, setSimStarted] = React.useState(false);
  const [columnTab, setColumnTab] = React.useState<ColumnTab>("trades");
  const [simNotice, setSimNotice] = React.useState<string | null>(null);
  const columnAvailable = tradeEntries.length > 0 || tradeData !== null;
  const columnVisible = columnAvailable && !tradesCollapsed;
  const simEnabled = simStarted && columnVisible;
  const [drafts, setDrafts] = React.useState<OrderDraft[]>(() => [newDraft("o0")]);
  const [draftSeq, setDraftSeq] = React.useState(1);
  const [activeDraftId, setActiveDraftId] = React.useState<string | null>(null);
  // Row whose price is being picked by clicking the chart
  const [pickingId, setPickingId] = React.useState<string | null>(null);
  const [feeText, setFeeText] = React.useState("");
  const [simBasisChoice, setSimBasisChoice] = React.useState<PriceBasis | null>(null);
  const simScopeKey = `${selectedId}:${kind}`;
  const [simScope, setSimScope] = React.useState(simScopeKey);
  const [simQuoteState, setSimQuoteState] = React.useState<{
    instrumentId: string | null;
    byKind: Partial<Record<UiMonitoringSeriesKind, MarketQuote>>;
  }>({ instrumentId: null, byKind: {} });
  const [simRefreshing, setSimRefreshing] = React.useState(false);
  const simRefreshRef = React.useRef<AbortController | null>(null);
  if (simScope !== simScopeKey) {
    setSimScope(simScopeKey);
    setDrafts([newDraft("o0")]);
    setDraftSeq(1);
    setActiveDraftId(null);
    setPickingId(null);
    setSimBasisChoice(null);
    setSimRefreshing(false);
    setSimNotice(null);
  }

  const simLastClose = activeSeries?.bars[activeSeries.bars.length - 1]?.close ?? null;
  const simQuotes = simQuoteState.instrumentId === selectedId ? simQuoteState.byKind : {};
  const simQuotePrices = Object.fromEntries(
    Object.entries(simQuotes).map(([k, q]) => [k, q.price])
  ) as Partial<Record<UiMonitoringSeriesKind, number | null>>;
  const simBases = selectedInstrument
    ? resolveBasisOptions({
        instrument: selectedInstrument,
        chartKind: kind,
        quotes: simQuotePrices,
        chartLastClose: simLastClose,
      })
    : [];
  // Series kinds to quote: both bases when there is a selector, else just the chart kind.
  const simKindsKey = simBases.length > 0 ? simBases.map((o) => o.kind).join(",") : kind;
  const simBasis =
    simBases.find((o) => o.basis === (simBasisChoice ?? defaultBasis(kind)) && o.available) ??
    simBases.find((o) => o.basis === defaultBasis(kind)) ??
    null;
  const simOther = simBases.find((o) => o !== simBasis) ?? null;

  // Prefill: quote the needed kinds (deduped) while the simulator is open. Stale requests are
  // aborted when the instrument changes; results only feed the prices that are untouched.
  React.useEffect(() => {
    if (!simEnabled || !selectedId) return;
    const controller = new AbortController();
    for (const quoteKind of simKindsKey.split(",") as UiMonitoringSeriesKind[]) {
      fetchQuote(selectedId, quoteKind, controller.signal).then((res) => {
        if (controller.signal.aborted) return;
        const quote: MarketQuote = "error" in res ? { price: null } : res;
        setSimQuoteState((prev) => ({
          instrumentId: selectedId,
          byKind: { ...(prev.instrumentId === selectedId ? prev.byKind : {}), [quoteKind]: quote },
        }));
      });
    }
    return () => {
      controller.abort();
      simRefreshRef.current?.abort();
      // An aborted refresh never reaches its own reset: clear the spinner here.
      setSimRefreshing(false);
    };
  }, [simEnabled, selectedId, simKindsKey]);

  const refreshSimQuote = () => {
    if (!selectedId) return;
    simRefreshRef.current?.abort();
    const controller = new AbortController();
    simRefreshRef.current = controller;
    const quoteKinds = simKindsKey.split(",") as UiMonitoringSeriesKind[];
    setSimRefreshing(true);
    Promise.all(quoteKinds.map((k) => fetchQuote(selectedId, k, controller.signal))).then(
      (results) => {
        if (controller.signal.aborted) return;
        setSimRefreshing(false);
        const fresh: Partial<Record<UiMonitoringSeriesKind, MarketQuote>> = {};
        results.forEach((res, i) => {
          fresh[quoteKinds[i]!] = "error" in res ? { price: null } : res;
        });
        setSimQuoteState((prev) => ({
          instrumentId: selectedId,
          byKind: { ...(prev.instrumentId === selectedId ? prev.byKind : {}), ...fresh },
        }));
        // Explicit request: replace whatever is typed (a failed fetch keeps the typed prices).
        const basisKind = simBasis?.kind ?? kind;
        if (fresh[basisKind]?.price != null) {
          setDrafts((prev) => prev.map((d) => ({ ...d, priceText: null })));
        }
      }
    );
  };

  const changeSimBasis = (next: PriceBasis) => {
    if (!simBasis || next === simBasis.basis) return;
    const target = simBases.find((o) => o.basis === next && o.available);
    if (!target) return;
    // Typed prices and target PPCs are per unit in the basis: re-express them in the new one
    // (amounts are money and don't change). A number that can't be converted blocks the switch
    // instead of silently turning into "follow the market" or keeping a wrong-currency value.
    const convertText = (text: string): string | null | undefined => {
      const typed = parseDecimalInput(text);
      if (!Number.isFinite(typed) || typed <= 0) return text; // not a number: leave as typed
      const converted = convertBasisPrice(typed, simBasis.factor, target.factor);
      return converted === null ? undefined : String(Number(converted.toFixed(4)));
    };
    const next_ = drafts.map((d) => ({
      ...d,
      priceText: d.priceText === null ? null : convertText(d.priceText),
      targetText: d.targetText === "" ? "" : convertText(d.targetText),
    }));
    if (next_.some((d) => d.priceText === undefined || d.targetText === undefined)) {
      setSimNotice(
        "No se pudo cambiar la base: falta la cotización para convertir los precios escritos. Actualizá el precio o borrá esos valores."
      );
      return;
    }
    setDrafts(next_ as OrderDraft[]);
    setSimNotice(null);
    setSimBasisChoice(next);
  };

  const updateDraft = (id: string, patch: Partial<OrderDraft>) =>
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const addDraft = () => {
    const id = `o${draftSeq}`;
    setDraftSeq(draftSeq + 1);
    // New orders default to the opposite side of the last one is NOT assumed: plain buy.
    setDrafts((prev) => [...prev, newDraft(id)]);
    setActiveDraftId(id);
  };
  const removeDraft = (id: string) => {
    setDrafts((prev) => (prev.length > 1 ? prev.filter((d) => d.id !== id) : prev));
    setPickingId((prev) => (prev === id ? null : prev));
  };
  const resetDrafts = () => {
    setDrafts([newDraft("o0")]);
    setDraftSeq(1);
    setActiveDraftId(null);
    setPickingId(null);
  };
  const handlePickPrice = (chartPrice: number) => {
    if (pickingId && simFactor) {
      updateDraft(pickingId, { priceText: String(Number(toBasisPrice(chartPrice, simFactor).toFixed(4))) });
    }
    setPickingId(null);
  };

  const simQuote = (simBasis ? simQuotes[simBasis.kind] : simQuotes[kind]) ?? null;
  const simMarketPrice = simBasis ? simBasis.marketPrice : (simQuote?.price ?? simLastClose);
  const simFactor = simBasis ? simBasis.factor : 1;
  const simEquivalentMarketPrice =
    simBasis && simOther && simMarketPrice !== null && simMarketPrice > 0
      ? convertBasisPrice(simMarketPrice, simBasis.factor, simOther.factor)
      : null;
  const simReferences = {
    market: simMarketPrice,
    lastClose: simLastClose !== null && simFactor ? toBasisPrice(simLastClose, simFactor) : null,
    avgCost: position?.avgCost != null && simFactor ? toBasisPrice(position.avgCost, simFactor) : null,
  };
  // Money in the instrument's own currency (pesos per unit paid); USD views need the native quote.
  const simMoneyFactor = moneyFactor(kind, simQuotePrices, simLastClose);
  const simMoneyCurrency: MonitoringCurrency = kind === "adr" || kind === "cedear-underlying" ? "ARS" : currency;
  const parsedFee = parseDecimalInput(feeText);
  const simFeePct = Number.isFinite(parsedFee) && parsedFee > 0 ? Math.min(parsedFee, 100) : 0;
  // "Resultado vs. último": live quote of the chart kind when known, else its last close.
  const simReference = (simQuotes[kind]?.price ?? null) ?? simLastClose;
  const { rows: simRows, result: simResult } = simEnabled
    ? resolveDrafts(position, drafts, {
        defaultBasisPrice: simMarketPrice,
        factor: simFactor,
        moneyFactor: simMoneyFactor,
        feePct: simFeePct,
        referencePrice: simReference,
      })
    : { rows: [], result: null };
  // Active on the chart (line + ghost markers) while the simulation has valid orders, whichever
  // tab is showing, so the user can compare against the real trades. React Compiler keeps the
  // array reference stable between unrelated renders.
  const simChartOrders = simResult
    ? ghostMarkers(
        simRows.flatMap((r) =>
          r.step ? [{ id: r.id, side: r.step.side, price: r.step.price, quantity: r.step.quantity }] : []
        )
      )
    : [];
  const simQuoteLoading =
    simRefreshing ||
    (simEnabled && simKindsKey.split(",").some((k) => simQuotes[k as UiMonitoringSeriesKind] === undefined));

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
  const showSeries = (
    instrumentId: string,
    nextKind: UiMonitoringSeriesKind,
    nextAdjusted: boolean = adjusted
  ) => {
    const requestId = ++seriesRequestRef.current;
    const loaded = loadedSeriesRef.current.get(seriesKey(instrumentId, nextKind, nextAdjusted));
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
        adjusted: nextAdjusted,
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

  const handleToggleKind = (targetKind: UiMonitoringSeriesKind) => {
    if (!selectedId || targetKind === kind) return;
    setKind(targetKind);
    showSeries(selectedId, targetKind);
    syncUrl(selectedId, targetKind);
  };

  const handleToggleAdjusted = (next: boolean) => {
    if (!selectedId || next === adjusted) return;
    setAdjusted(next);
    // Drop the displayed series so the previous basis never renders (or auto-loads history)
    // while the other one is in flight.
    setSeries(null);
    showSeries(selectedId, kind, next);
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
  // Argentine stocks with a US ADR can switch to it (USD, Yahoo); CEDEARs keep their own toggle.
  const adrSymbol =
    selectedInstrument?.type === "STOCK_AR" ? adrSymbolFor(selectedInstrument.ticker) : null;
  const scaleLabel =
    kind === "cedear-underlying"
      ? "Equivalente subyacente"
      : kind === "adr"
        ? "Equivalente ADR"
        : "Equivalente en el gráfico";
  const showTradesList = columnAvailable;
  const tradesVisible = columnVisible;
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
              onClick={() => handleToggleKind("cedear-underlying")}
              disabled={isPending}
              className={segmentButton(kind === "cedear-underlying")}
            >
              USD subyacente
            </button>
            <button
              type="button"
              onClick={() => handleToggleKind("native")}
              disabled={isPending}
              className={segmentButton(kind === "native")}
            >
              ARS CEDEAR
            </button>
          </div>
        )}

        {adrSymbol && (
          <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => handleToggleKind("native")}
              disabled={isPending}
              className={segmentButton(kind === "native")}
            >
              ARS local
            </button>
            <button
              type="button"
              onClick={() => handleToggleKind("adr")}
              disabled={isPending}
              title={`ADR ${adrSymbol} en USD`}
              className={segmentButton(kind === "adr")}
            >
              USD ADR
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

          {splitAdjustmentEnabled && (
            <div
              className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/90 p-0.5 text-xs"
              title="Ajusta los precios históricos por splits para que sean comparables"
            >
              {([true, false] as const).map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  aria-pressed={adjusted === value}
                  onClick={() => handleToggleAdjusted(value)}
                  className={`rounded-md px-2 py-1 font-medium transition-colors ${
                    adjusted === value
                      ? "bg-teal-950 text-teal-300 border border-teal-800/60 shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {value ? "Ajustado" : "Sin ajustar"}
                </button>
              ))}
            </div>
          )}

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
              onClick={() => {
                setTradesCollapsed(!tradesCollapsed);
                setPickingId(null);
              }}
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
            ? "grid min-h-0 gap-3 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]"
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
                    {isCedear && kind === "cedear-underlying" ? " en su versión subyacente" : ""}
                    {kind === "adr" ? " en su versión ADR" : ""}.
                    {isCedear || adrSymbol ? " Probá con la otra vista o " : " Probá "}
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
              simulatedAvgCost={simResult?.totals.avgCost ?? null}
              simulatedOrders={simChartOrders}
              pickMode={pickingId !== null}
              onPickPrice={handlePickPrice}
              onPickCancel={() => setPickingId(null)}
              activeMarkerId={activeMarkerId}
              onMarkerHover={setActiveMarkerId}
              focusRequest={focusRequest}
              scaleLabel={scaleLabel}
            />
          )}
        </div>

        {tradesVisible && (
          <div className="h-[420px] min-h-0 lg:h-auto">
            <OperationsColumn
              tab={simStarted ? columnTab : "trades"}
              onTabChange={(tab) => {
                setColumnTab(tab);
                setPickingId(null);
              }}
              tradesCount={tradeEntries.length}
              simStarted={simStarted}
              simulating={simResult !== null}
              onStartSimulation={() => {
                setSimStarted(true);
                setColumnTab("sim");
              }}
            >
              {simStarted && columnTab === "sim" ? (
                <BuySimulator
                  scopeKey={simScopeKey}
                  notice={simNotice}
                  drafts={drafts}
                  rows={simRows}
                  onDraftChange={updateDraft}
                  onAddDraft={addDraft}
                  onRemoveDraft={removeDraft}
                  onReset={resetDrafts}
                  activeDraftId={activeDraftId}
                  onActivateDraft={setActiveDraftId}
                  pickingId={pickingId}
                  onTogglePick={(id) => setPickingId((prev) => (prev === id ? null : id))}
                  feeText={feeText}
                  onFeeChange={setFeeText}
                  feePct={simFeePct}
                  bases={simBases}
                  basis={simBasis}
                  otherBasis={simOther}
                  onBasisChange={changeSimBasis}
                  unitsLabel={selectedInstrument?.type === "CEDEAR" ? "CEDEARs" : "acciones"}
                  quote={simQuote}
                  quoteLoading={simQuoteLoading}
                  marketPrice={simMarketPrice}
                  equivalentMarketPrice={simEquivalentMarketPrice}
                  references={simReferences}
                  onRefreshQuote={refreshSimQuote}
                  position={position}
                  result={simResult}
                  referencePrice={simReference}
                  currency={currency}
                  moneyCurrency={simMoneyCurrency}
                  moneyFactor={simMoneyFactor}
                />
              ) : tradeEntries.length > 0 ? (
                <TradesList
                  entries={tradeEntries}
                  chartCurrency={currency}
                  scaleLabel={scaleLabel}
                  activeId={activeMarkerId}
                  onHover={setActiveMarkerId}
                  onSelect={handleSelectTrade}
                />
              ) : (
                <p className="px-3 py-4 text-xs text-zinc-500">
                  Todavía no tenés operaciones en este activo. Podés simular una compra igual.
                </p>
              )}
            </OperationsColumn>
          </div>
        )}
      </div>

      {/* Compact metadata */}
      {activeSeries && (
        <p className="truncate text-[11px] leading-relaxed text-zinc-500">
          Fuente: <span className="uppercase">{activeSeries.provider}</span> ·{" "}
          <span className="font-mono">{activeSeries.source}</span> · Ajuste:{" "}
          {adjustmentPolicyLabel(activeSeries.adjustmentPolicy)} · {formatTradingDate(activeSeries.firstDate)} —{" "}
          {formatTradingDate(activeSeries.lastDate)} · {activeSeries.bars.length} ruedas
        </p>
      )}
    </div>
  );
}
