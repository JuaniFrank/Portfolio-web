import type { InstrumentType } from "@/lib/generated/prisma";

const DATA912_LIVE_BASE = "https://data912.com/live";
const REVALIDATE_SECONDS = 60; // 1 minute for live quotes

export type Data912LiveQuote = {
  symbol: string;
  close: number;
  volume: number | null;
  bid: number | null;
  ask: number | null;
  pctChange: number | null;
};

type Data912RawItem = {
  symbol?: unknown;
  c?: unknown;
  v?: unknown;
  px_bid?: unknown;
  px_ask?: unknown;
  pct_change?: unknown;
  [key: string]: unknown;
};

export async function fetchLiveQuoteFromData912(
  ticker: string,
  type: InstrumentType
): Promise<Data912LiveQuote | null> {
  const endpoint =
    type === "CEDEAR"
      ? `${DATA912_LIVE_BASE}/arg_cedears`
      : `${DATA912_LIVE_BASE}/arg_stocks`;

  try {
    const res = await fetch(endpoint, {
      next: { revalidate: REVALIDATE_SECONDS, tags: ["data912-live"] },
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return null;

    const rawItems = (await res.json()) as Data912RawItem[];
    if (!Array.isArray(rawItems)) return null;

    const upperTicker = ticker.toUpperCase();
    const match = rawItems.find(
      (item) => typeof item.symbol === "string" && item.symbol.toUpperCase() === upperTicker
    );

    if (!match || typeof match.c !== "number" || !Number.isFinite(match.c)) {
      return null;
    }

    return {
      symbol: upperTicker,
      close: match.c,
      volume: typeof match.v === "number" && Number.isFinite(match.v) ? match.v : null,
      bid: typeof match.px_bid === "number" && Number.isFinite(match.px_bid) ? match.px_bid : null,
      ask: typeof match.px_ask === "number" && Number.isFinite(match.px_ask) ? match.px_ask : null,
      pctChange:
        typeof match.pct_change === "number" && Number.isFinite(match.pct_change)
          ? match.pct_change
          : null,
    };
  } catch (error) {
    console.error(`fetchLiveQuoteFromData912 error for ${ticker}:`, error);
    return null;
  }
}
