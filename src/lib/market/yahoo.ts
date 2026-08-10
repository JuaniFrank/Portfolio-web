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
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
      events?: {
        dividends?: Record<string, { amount: number; date: number }>;
        splits?: Record<
          string,
          { date: number; numerator: number; denominator: number; splitRatio?: string }
        >;
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

// ============================================================
// HISTÓRICO EOD
// ============================================================

/** Una rueda: cierre diario en la moneda nativa del ticker. */
export type YahooHistoryBar = {
  /** Medianoche UTC del día de la rueda — clave estable para `PriceCache`. */
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  /**
   * Cierre **crudo**, no ajustado.
   *
   * Yahoo también expone `adjclose` (ajustado retroactivamente por splits y
   * dividendos), pero NO lo usamos: `buildHoldings` ya ajusta las *cantidades*
   * vía `CorporateEvent`. Aplicar un precio ajustado sobre una cantidad ajustada
   * duplica el ajuste y el valor histórico sale mal. El ajuste va de un solo lado.
   */
  close: number;
  volume: number | null;
};

/** Split reportado por Yahoo. Solo lo usamos para *detectar* eventos que falten en `CorporateEvent`. */
export type YahooSplitEvent = {
  date: Date;
  numerator: number;
  denominator: number;
};

export type FetchHistoryResult = {
  symbol: string;
  currency: string | null;
  bars: YahooHistoryBar[];
  splits: YahooSplitEvent[];
};

/** Medianoche UTC del instante dado. */
function toUtcDay(unixSeconds: number): Date {
  const d = new Date(unixSeconds * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Serie diaria de cierres entre dos fechas.
 *
 * Yahoo devuelve un timestamp por rueda al horario de apertura del mercado
 * (p. ej. 14:00 UTC para BYMA, que es 11:00 ART). Truncar a día UTC da la fecha
 * de rueda correcta tanto para mercados argentinos como estadounidenses, porque
 * ambos abren durante la tarde UTC.
 *
 * Las ruedas con `close: null` (suspensiones, feriados que Yahoo igual lista) se
 * descartan: es mejor que el consumidor haga forward-fill explícito que inventar
 * un cierre. Si hay timestamps duplicados para el mismo día, gana el último.
 *
 * `cache: "no-store"` porque esto lo consumen crons, que siempre quieren la
 * última rueda disponible.
 */
export async function fetchYahooHistory(
  symbol: string,
  range: { from: Date; to: Date }
): Promise<FetchHistoryResult> {
  const period1 = Math.floor(range.from.getTime() / 1000);
  const period2 = Math.ceil(range.to.getTime() / 1000);
  const url =
    `${BASE_URL}/${encodeURIComponent(symbol)}` +
    `?period1=${period1}&period2=${period2}&interval=1d&events=split`;

  const res = await fetch(url, { headers: COMMON_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`Yahoo history ${symbol}: HTTP ${res.status}`);

  const body = (await res.json()) as YahooChartResponse;
  if (body.chart?.error) {
    throw new Error(`Yahoo history ${symbol}: ${body.chart.error.description ?? "error"}`);
  }

  const result = body.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];

  // Dedupe por día conservando el último valor visto.
  const byDay = new Map<number, YahooHistoryBar>();
  for (let i = 0; i < timestamps.length; i += 1) {
    const ts = timestamps[i];
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    const close = finiteOrNull(quote?.close?.[i]);
    if (close === null || close <= 0) continue;

    const date = toUtcDay(ts);
    byDay.set(date.getTime(), {
      date,
      open: finiteOrNull(quote?.open?.[i]),
      high: finiteOrNull(quote?.high?.[i]),
      low: finiteOrNull(quote?.low?.[i]),
      close,
      volume: finiteOrNull(quote?.volume?.[i]),
    });
  }

  const splits: YahooSplitEvent[] = Object.values(result?.events?.splits ?? {})
    .filter(
      (s) =>
        Number.isFinite(s?.date) &&
        Number.isFinite(s?.numerator) &&
        Number.isFinite(s?.denominator) &&
        s.denominator !== 0
    )
    .map((s) => ({
      date: toUtcDay(s.date),
      numerator: s.numerator,
      denominator: s.denominator,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    symbol,
    currency: result?.meta?.currency ?? null,
    bars: [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime()),
    splits,
  };
}
