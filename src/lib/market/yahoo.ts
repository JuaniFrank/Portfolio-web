export type YahooDividendEvent = {
  /** Unix seconds. */
  timestamp: number;
  /** Monto por acción en la moneda del ticker. */
  amount: number;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        symbol?: string;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        regularMarketTime?: number;
        exchangeName?: string;
      };
      events?: {
        dividends?: Record<string, { amount: number; date: number }>;
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
};

const BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const COMMON_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; portafolio-web/0.1)",
  Accept: "application/json",
} as const;

/**
 * Yahoo lista CEDEARs argentinos con sufijo .BA (e.g. AAPL.BA, GGAL.BA).
 * Si el ticker viene sin sufijo y es un instrumento argentino, lo agregamos.
 */
export function buildYahooSymbol(ticker: string, isArgentinian: boolean): string {
  const cleaned = ticker.trim().toUpperCase();
  if (!cleaned) return cleaned;
  if (cleaned.includes(".")) return cleaned;
  return isArgentinian ? `${cleaned}.BA` : cleaned;
}

export type FetchDividendsResult = {
  symbol: string;
  currency: string | null;
  dividends: YahooDividendEvent[];
};

export async function fetchYahooDividends(symbol: string): Promise<FetchDividendsResult> {
  const url = `${BASE_URL}/${encodeURIComponent(symbol)}?range=5y&interval=1mo&events=div`;
  const res = await fetch(url, {
    headers: COMMON_HEADERS,
    next: { revalidate: 60 * 60 * 12 },
  });

  if (!res.ok) throw new Error(`Yahoo chart ${symbol}: HTTP ${res.status}`);
  const body = (await res.json()) as YahooChartResponse;
  if (body.chart?.error) {
    throw new Error(`Yahoo chart ${symbol}: ${body.chart.error.description ?? "error"}`);
  }

  const result = body.chart?.result?.[0];
  const rawDividends = result?.events?.dividends ?? {};
  const dividends: YahooDividendEvent[] = Object.values(rawDividends)
    .map((d) => ({ timestamp: d.date, amount: d.amount }))
    .filter((d) => Number.isFinite(d.timestamp) && Number.isFinite(d.amount) && d.amount > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    symbol,
    currency: result?.meta?.currency ?? null,
    dividends,
  };
}

export type YahooQuote = {
  symbol: string;
  /** Último precio operado / cierre del día. */
  price: number;
  currency: string | null;
  /** Cierre anterior — útil para calcular variación diaria. */
  previousClose: number | null;
  /** Timestamp Unix segundos de la última cotización. */
  asOf: number | null;
};

export async function fetchYahooQuote(symbol: string): Promise<YahooQuote> {
  const url = `${BASE_URL}/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const res = await fetch(url, {
    headers: COMMON_HEADERS,
    next: { revalidate: 60 * 5 },
  });

  if (!res.ok) throw new Error(`Yahoo quote ${symbol}: HTTP ${res.status}`);
  const body = (await res.json()) as YahooChartResponse;
  if (body.chart?.error) {
    throw new Error(`Yahoo quote ${symbol}: ${body.chart.error.description ?? "error"}`);
  }

  const meta = body.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (price === undefined || !Number.isFinite(price)) {
    throw new Error(`Yahoo quote ${symbol}: no regularMarketPrice`);
  }

  return {
    symbol,
    price,
    currency: meta?.currency ?? null,
    previousClose: Number.isFinite(meta?.chartPreviousClose) ? meta!.chartPreviousClose! : null,
    asOf: Number.isFinite(meta?.regularMarketTime) ? meta!.regularMarketTime! : null,
  };
}
