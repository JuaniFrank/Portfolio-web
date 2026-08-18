import type {
  MonitoringAdjustmentPolicy,
  MonitoringBar,
  MonitoringCurrency,
  MonitoringHistoryStatus,
  MonitoringRange,
  MonitoringSeries,
  MonitoringSeriesKind,
} from "./types";

/**
 * Deduplicate bars by time (YYYY-MM-DD) keeping the latest occurrence,
 * and sort ascending by date.
 */
export function dedupeAndSortBars(bars: MonitoringBar[]): MonitoringBar[] {
  const map = new Map<string, MonitoringBar>();
  for (const bar of bars) {
    if (!bar.time) continue;
    map.set(bar.time, bar);
  }

  return Array.from(map.values()).sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Filter bars by range relative to a reference UTC date.
 */
export function filterBarsByRange(
  bars: MonitoringBar[],
  range: MonitoringRange,
  referenceDateUtc: Date = new Date()
): MonitoringBar[] {
  if (range === "ALL" || bars.length === 0) {
    return bars;
  }

  const daysBack =
    range === "1M"
      ? 30
      : range === "3M"
        ? 90
        : range === "6M"
          ? 180
          : range === "1Y"
            ? 365
            : 0;

  if (daysBack === 0) return bars;

  const cutoff = new Date(
    Date.UTC(
      referenceDateUtc.getUTCFullYear(),
      referenceDateUtc.getUTCMonth(),
      referenceDateUtc.getUTCDate() - daysBack
    )
  );
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return bars.filter((bar) => bar.time >= cutoffStr);
}

/**
 * Validate OHLC bar correctness and completeness.
 */
export function validateOhlc(bar: MonitoringBar): {
  isValid: boolean;
  isComplete: boolean;
} {
  const { open, high, low, close } = bar;
  const isComplete =
    open !== null &&
    high !== null &&
    low !== null &&
    close !== null &&
    Number.isFinite(open) &&
    Number.isFinite(high) &&
    Number.isFinite(low) &&
    Number.isFinite(close);

  if (!isComplete) {
    return {
      isValid: close !== null && Number.isFinite(close) && close > 0,
      isComplete: false,
    };
  }

  const isValid =
    low! <= open! &&
    low! <= close &&
    high! >= open! &&
    high! >= close &&
    open! > 0 &&
    close > 0;

  return { isValid, isComplete };
}

/**
 * Calculate the latest value and percentage change against the previous trading close.
 * Returns changePct: null for the first data point (not 0%).
 */
export function calculateChangePct(bars: MonitoringBar[]): {
  lastValue: number | null;
  changePct: number | null;
} {
  if (bars.length === 0) {
    return { lastValue: null, changePct: null };
  }

  const lastBar = bars[bars.length - 1]!;
  const lastValue = lastBar.close;

  if (bars.length < 2) {
    return { lastValue, changePct: null };
  }

  const prevBar = bars[bars.length - 2]!;
  if (!prevBar.close || prevBar.close <= 0) {
    return { lastValue, changePct: null };
  }

  const changePct = ((lastValue - prevBar.close) / prevBar.close) * 100;
  return { lastValue, changePct };
}

/**
 * Merge cached bars with externally fetched historical bars.
 * External history fills in older missing dates and supplements cached points.
 */
export function mergeHistoryBars(
  cachedBars: MonitoringBar[],
  externalBars: MonitoringBar[]
): MonitoringBar[] {
  const mergedMap = new Map<string, MonitoringBar>();

  // Insert external bars first
  for (const bar of externalBars) {
    mergedMap.set(bar.time, bar);
  }

  // Overlay with cached bars (or prefer more complete OHLC)
  for (const cached of cachedBars) {
    const existing = mergedMap.get(cached.time);
    if (!existing) {
      mergedMap.set(cached.time, cached);
    } else {
      // If cached has full OHLC and external doesn't, keep cached
      const cachedValidation = validateOhlc(cached);
      const extValidation = validateOhlc(existing);
      if (cachedValidation.isComplete && !extValidation.isComplete) {
        mergedMap.set(cached.time, cached);
      }
    }
  }

  return Array.from(mergedMap.values()).sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Compute data quality metrics and warnings for a series.
 */
export function calculateDataQuality(
  bars: MonitoringBar[],
  missingCclDays = 0
): MonitoringSeries["dataQuality"] {
  if (bars.length === 0) {
    return {
      missingDays: 0,
      stalePoints: 0,
      missingCclDays,
      missingOhlcBars: 0,
      warning: "Sin datos históricos disponibles",
    };
  }

  let staleCount = 0;
  let missingOhlcCount = 0;
  let maxConsecutiveSame = 0;
  let currentConsecutiveSame = 1;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    const { isComplete } = validateOhlc(bar);
    if (!isComplete) {
      missingOhlcCount++;
    }

    if (i > 0) {
      if (bar.close === bars[i - 1]!.close) {
        currentConsecutiveSame++;
        if (currentConsecutiveSame > maxConsecutiveSame) {
          maxConsecutiveSame = currentConsecutiveSame;
        }
      } else {
        currentConsecutiveSame = 1;
      }
    }
  }

  if (maxConsecutiveSame >= 5) {
    staleCount = maxConsecutiveSame;
  }

  const warnings: string[] = [];
  if (missingOhlcCount > 0) {
    warnings.push(`${missingOhlcCount} barras tienen OHLC incompleto`);
  }
  if (staleCount >= 5) {
    warnings.push(`Serie con ${staleCount} ruedas consecutivas sin cambio de precio`);
  }
  if (missingCclDays > 0) {
    warnings.push(`${missingCclDays} días sin cotización CCL`);
  }

  return {
    missingDays: 0,
    stalePoints: staleCount,
    missingCclDays,
    missingOhlcBars: missingOhlcCount,
    warning: warnings.length > 0 ? warnings.join(" • ") : null,
  };
}

/**
 * Assemble a MonitoringSeries object from raw bars and metadata.
 */
export function buildMonitoringSeries(opts: {
  instrumentId: string;
  ticker: string;
  label: string;
  currency: MonitoringCurrency;
  kind: MonitoringSeriesKind;
  chartType?: MonitoringSeries["chartType"];
  provider: MonitoringSeries["provider"];
  source: string;
  adjustmentPolicy?: MonitoringAdjustmentPolicy;
  historyStatus: MonitoringHistoryStatus;
  bars: MonitoringBar[];
  missingCclDays?: number;
}): MonitoringSeries {
  const sortedBars = dedupeAndSortBars(opts.bars);
  const { lastValue, changePct } = calculateChangePct(sortedBars);
  const dataQuality = calculateDataQuality(sortedBars, opts.missingCclDays ?? 0);

  return {
    instrumentId: opts.instrumentId,
    ticker: opts.ticker,
    label: opts.label,
    currency: opts.currency,
    kind: opts.kind,
    chartType: opts.chartType ?? "line",
    provider: opts.provider,
    source: opts.source,
    adjustmentPolicy: opts.adjustmentPolicy ?? "raw",
    historyStatus: opts.historyStatus,
    bars: sortedBars,
    firstDate: sortedBars[0]?.time ?? null,
    lastDate: sortedBars[sortedBars.length - 1]?.time ?? null,
    lastValue,
    changePct,
    dataQuality,
  };
}
