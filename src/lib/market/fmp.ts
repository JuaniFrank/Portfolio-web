import type { MonitoringBar } from "@/lib/monitoreo/types";

const FMP_BASE = "https://financialmodelingprep.com/api/v3";

type FmpHistoricalItem = {
  date?: unknown;
  open?: unknown;
  high?: unknown;
  low?: unknown;
  close?: unknown;
  volume?: unknown;
  [key: string]: unknown;
};

type FmpResponse = {
  symbol?: string;
  historical?: FmpHistoricalItem[];
};

export async function fetchFmpHistory(
  symbol: string,
  opts?: { nonSplitAdjusted?: boolean }
): Promise<{ bars: MonitoringBar[]; error?: string }> {
  const apiKey = process.env.FINANCIALMODELINGPREP_APIKEY;
  if (!apiKey) {
    return { bars: [], error: "FINANCIALMODELINGPREP_APIKEY no configurada" };
  }

  const endpoint = opts?.nonSplitAdjusted
    ? `${FMP_BASE}/historical-price-eod/non-split-adjusted/${encodeURIComponent(symbol)}?apikey=${apiKey}`
    : `${FMP_BASE}/historical-price-full/${encodeURIComponent(symbol)}?apikey=${apiKey}`;

  try {
    const res = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600, tags: [`fmp-hist-${symbol}`] },
    });

    if (!res.ok) {
      return { bars: [], error: `FMP HTTP ${res.status}` };
    }

    const json = (await res.json()) as FmpResponse | FmpHistoricalItem[];
    const rawItems = Array.isArray(json)
      ? json
      : Array.isArray(json?.historical)
        ? json.historical
        : [];

    const bars: MonitoringBar[] = [];

    for (const item of rawItems) {
      if (!item || typeof item !== "object") continue;

      let dateStr: string | null = null;
      if (typeof item.date === "string") {
        dateStr = item.date.slice(0, 10);
      }

      if (!dateStr || isNaN(Date.parse(dateStr))) continue;

      const close = typeof item.close === "number" && Number.isFinite(item.close) ? item.close : null;
      if (close === null || close <= 0) continue;

      const open = typeof item.open === "number" && Number.isFinite(item.open) ? item.open : null;
      const high = typeof item.high === "number" && Number.isFinite(item.high) ? item.high : null;
      const low = typeof item.low === "number" && Number.isFinite(item.low) ? item.low : null;
      const volume = typeof item.volume === "number" && Number.isFinite(item.volume) ? item.volume : null;

      bars.push({
        time: dateStr,
        open,
        high,
        low,
        close,
        volume,
      });
    }

    return { bars };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { bars: [], error: `Error consultando FMP para ${symbol}: ${msg}` };
  }
}
