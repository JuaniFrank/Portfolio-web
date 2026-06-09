import Decimal from "decimal.js";
import type { InstrumentType } from "@/lib/generated/prisma";
import type { DividendCurrency, UpcomingDividend } from "./types";
import { buildYahooSymbol, fetchYahooDividends, type YahooDividendEvent } from "@/lib/market/yahoo";

export type HoldingForForecast = {
  ticker: string;
  instrumentName: string | null;
  instrumentType: InstrumentType;
  /** Cantidad actual en cartera. */
  quantity: string;
};

const MS_PER_DAY = 86_400_000;
const ARGENTINIAN_TYPES = new Set<InstrumentType>([
  "CEDEAR",
  "STOCK_AR",
  "BOND_AR",
  "LETRA",
  "ON",
]);

function averageIntervalDays(events: YahooDividendEvent[]): number | null {
  if (events.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1]!.timestamp;
    const curr = events[i]!.timestamp;
    const gap = (curr - prev) / (60 * 60 * 24);
    if (gap > 5 && gap < 540) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

function pickCurrency(meta: string | null): DividendCurrency {
  if (!meta) return "ARS";
  const c = meta.toUpperCase();
  if (c === "USD") return "USD";
  return "ARS";
}

export type ForecastResult = {
  upcoming: UpcomingDividend[];
  errors: string[];
};

export async function forecastUpcomingDividends(
  holdings: HoldingForForecast[],
  horizonMonths = 6
): Promise<ForecastResult> {
  const errors: string[] = [];
  const now = Date.now();
  const horizonMs = horizonMonths * 31 * MS_PER_DAY;

  const tasks = holdings.map(async (h): Promise<UpcomingDividend[]> => {
    const qty = new Decimal(h.quantity);
    if (qty.lte(0)) return [];

    const symbol = buildYahooSymbol(h.ticker, ARGENTINIAN_TYPES.has(h.instrumentType));
    try {
      const { dividends, currency } = await fetchYahooDividends(symbol);
      if (dividends.length === 0) return [];

      const last = dividends[dividends.length - 1]!;
      const cadenceDays = averageIntervalDays(dividends);
      const lastAmount = new Decimal(last.amount);
      const ccy = pickCurrency(currency);

      const projections: UpcomingDividend[] = [];
      if (!cadenceDays) {
        const nextTs = last.timestamp * 1000 + 365 * MS_PER_DAY;
        if (nextTs > now && nextTs - now <= horizonMs) {
          projections.push({
            ticker: h.ticker.toUpperCase(),
            instrumentName: h.instrumentName,
            estimatedDate: new Date(nextTs).toISOString(),
            estimatedAmountPerShare: lastAmount.toFixed(4),
            quantity: qty.toFixed(4).replace(/\.?0+$/, ""),
            estimatedTotal: lastAmount.mul(qty).toFixed(2),
            currencyCode: ccy,
            isEstimate: true,
          });
        }
        return projections;
      }

      let nextTs = last.timestamp * 1000 + cadenceDays * MS_PER_DAY;
      let amount = lastAmount;
      while (nextTs <= now) {
        nextTs += cadenceDays * MS_PER_DAY;
      }
      while (nextTs - now <= horizonMs) {
        projections.push({
          ticker: h.ticker.toUpperCase(),
          instrumentName: h.instrumentName,
          estimatedDate: new Date(nextTs).toISOString(),
          estimatedAmountPerShare: amount.toFixed(4),
          quantity: qty.toFixed(4).replace(/\.?0+$/, ""),
          estimatedTotal: amount.mul(qty).toFixed(2),
          currencyCode: ccy,
          isEstimate: true,
        });
        nextTs += cadenceDays * MS_PER_DAY;
      }
      return projections;
    } catch (err) {
      errors.push(`${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  });

  const results = await Promise.all(tasks);
  const upcoming = results.flat().sort((a, b) => a.estimatedDate.localeCompare(b.estimatedDate));

  return { upcoming, errors };
}
