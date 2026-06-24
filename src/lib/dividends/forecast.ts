import Decimal from "decimal.js";
import type { InstrumentType } from "@/lib/generated/prisma";
import type { DividendCurrency, UpcomingDividend } from "./types";
import {
  buildYahooSymbol,
  fetchYahooDividends,
  fetchYahooQuote,
  type YahooDividendEvent,
} from "@/lib/market/yahoo";

export type HoldingForForecast = {
  ticker: string;
  instrumentName: string | null;
  instrumentType: InstrumentType;
  /** Cantidad actual en cartera. */
  quantity: string;
};

const MS_PER_DAY = 86_400_000;
const ARGENTINIAN_TYPES = new Set<InstrumentType>([
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

/**
 * Para CEDEARs derivamos el ratio (cuántos CEDEARs equivalen a 1 acción USA)
 * a partir del arbitraje vigente: ratio = (priceUsd × cclToday) / priceArs.
 *
 * Esto evita mantener tablas hardcodeadas y se auto-corrige si la relación
 * cambia. Si falta cualquier insumo (CCL, quotes) caemos al método legacy
 * (PM.BA en ARS) para no perder la estimación.
 */
async function forecastCedear(
  h: HoldingForForecast,
  qty: Decimal,
  cclToday: number | null,
  now: number,
  horizonMs: number
): Promise<UpcomingDividend[]> {
  const usaSymbol = h.ticker.trim().toUpperCase();
  const baSymbol = `${usaSymbol}.BA`;

  const [usaDivResult, usaQuoteResult, baQuoteResult] = await Promise.allSettled([
    fetchYahooDividends(usaSymbol),
    fetchYahooQuote(usaSymbol),
    fetchYahooQuote(baSymbol),
  ]);

  if (
    usaDivResult.status !== "fulfilled" ||
    usaQuoteResult.status !== "fulfilled" ||
    baQuoteResult.status !== "fulfilled" ||
    !cclToday ||
    cclToday <= 0
  ) {
    // No tenemos data suficiente para el path nuevo — caemos al legacy.
    return forecastFromArsCedear(h, qty, now, horizonMs);
  }

  const usaDivs = usaDivResult.value.dividends;
  if (usaDivs.length === 0) return [];

  const priceUsd = usaQuoteResult.value.price;
  const priceArs = baQuoteResult.value.price;
  if (priceUsd <= 0 || priceArs <= 0) return [];

  const ratio = Math.round((priceUsd * cclToday) / priceArs);
  if (!Number.isFinite(ratio) || ratio < 1) return [];

  const last = usaDivs[usaDivs.length - 1]!;
  const lastUsdPerShare = new Decimal(last.amount);
  const perCedearUsd = lastUsdPerShare.div(ratio);
  const cadenceDays = averageIntervalDays(usaDivs);

  return projectFutureDividends({
    ticker: usaSymbol,
    instrumentName: h.instrumentName,
    amountPerUnit: perCedearUsd,
    qty,
    lastTimestampMs: last.timestamp * 1000,
    cadenceDays,
    currency: "USD",
    now,
    horizonMs,
  });
}

/** Camino legacy para STOCK_AR/USA o cuando falla el path con ratio derivado. */
async function forecastFromArsCedear(
  h: HoldingForForecast,
  qty: Decimal,
  now: number,
  horizonMs: number
): Promise<UpcomingDividend[]> {
  const symbol = buildYahooSymbol(h.ticker, ARGENTINIAN_TYPES.has(h.instrumentType));
  const { dividends, currency } = await fetchYahooDividends(symbol);
  if (dividends.length === 0) return [];

  const last = dividends[dividends.length - 1]!;
  const cadenceDays = averageIntervalDays(dividends);
  return projectFutureDividends({
    ticker: h.ticker.toUpperCase(),
    instrumentName: h.instrumentName,
    amountPerUnit: new Decimal(last.amount),
    qty,
    lastTimestampMs: last.timestamp * 1000,
    cadenceDays,
    currency: pickCurrency(currency),
    now,
    horizonMs,
  });
}

function projectFutureDividends(args: {
  ticker: string;
  instrumentName: string | null;
  amountPerUnit: Decimal;
  qty: Decimal;
  lastTimestampMs: number;
  cadenceDays: number | null;
  currency: DividendCurrency;
  now: number;
  horizonMs: number;
}): UpcomingDividend[] {
  const { amountPerUnit, qty, lastTimestampMs, cadenceDays, now, horizonMs } = args;
  const projections: UpcomingDividend[] = [];

  if (!cadenceDays) {
    const nextTs = lastTimestampMs + 365 * MS_PER_DAY;
    if (nextTs > now && nextTs - now <= horizonMs) {
      projections.push(makeProjection(args, amountPerUnit, qty, nextTs));
    }
    return projections;
  }

  // Tolerancia: los gaps reales suelen variar ±15% alrededor de la mediana
  // (PM: 83–99 días con mediana 91). Si la proyección cae apenas en el pasado
  // por esa variabilidad, la mantenemos como "próxima" en vez de saltar al
  // siguiente ciclo y perder el pago real que está por venir.
  const graceDays = Math.max(15, cadenceDays * 0.2);
  const graceMs = graceDays * MS_PER_DAY;

  let nextTs = lastTimestampMs + cadenceDays * MS_PER_DAY;
  while (nextTs < now - graceMs) nextTs += cadenceDays * MS_PER_DAY;
  while (nextTs - now <= horizonMs) {
    projections.push(makeProjection(args, amountPerUnit, qty, nextTs));
    nextTs += cadenceDays * MS_PER_DAY;
  }
  return projections;
}

function makeProjection(
  args: { ticker: string; instrumentName: string | null; currency: DividendCurrency },
  amountPerUnit: Decimal,
  qty: Decimal,
  ts: number
): UpcomingDividend {
  return {
    ticker: args.ticker,
    instrumentName: args.instrumentName,
    estimatedDate: new Date(ts).toISOString(),
    estimatedAmountPerShare: amountPerUnit.toFixed(4),
    quantity: qty.toFixed(4).replace(/\.?0+$/, ""),
    estimatedTotal: amountPerUnit.mul(qty).toFixed(2),
    currencyCode: args.currency,
    isEstimate: true,
  };
}

export async function forecastUpcomingDividends(
  holdings: HoldingForForecast[],
  cclToday: number | null,
  horizonMonths = 6
): Promise<ForecastResult> {
  const errors: string[] = [];
  const now = Date.now();
  const horizonMs = horizonMonths * 31 * MS_PER_DAY;

  const tasks = holdings.map(async (h): Promise<UpcomingDividend[]> => {
    const qty = new Decimal(h.quantity);
    if (qty.lte(0)) return [];

    try {
      if (h.instrumentType === "CEDEAR") {
        return await forecastCedear(h, qty, cclToday, now, horizonMs);
      }
      return await forecastFromArsCedear(h, qty, now, horizonMs);
    } catch (err) {
      errors.push(`${h.ticker}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  });

  const results = await Promise.all(tasks);
  const upcoming = results.flat().sort((a, b) => a.estimatedDate.localeCompare(b.estimatedDate));

  return { upcoming, errors };
}
