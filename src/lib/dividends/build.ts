import Decimal from "decimal.js";
import type {
  DividendByMonth,
  DividendByTicker,
  DividendKpis,
  DividendMonth,
  DividendsPageData,
  ReceivedDividend,
  UpcomingDividend,
} from "./types";

const MONTH_LABELS = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1]} ${String(year).slice(2)}`;
}

function toArs(amount: string, currency: "ARS" | "USD", cclRate: number | null): Decimal {
  const value = new Decimal(amount);
  if (currency === "ARS") return value;
  if (!cclRate || cclRate <= 0) return new Decimal(0);
  return value.mul(cclRate);
}

function toUsd(amount: string, currency: "ARS" | "USD", cclRate: number | null): Decimal {
  const value = new Decimal(amount);
  if (currency === "USD") return value;
  if (!cclRate || cclRate <= 0) return new Decimal(0);
  return value.div(cclRate);
}

function pickHoldingQuantity(
  holdings: Array<{ ticker: string; quantity: string }>,
  ticker: string
): string {
  const t = ticker.toUpperCase();
  const found = holdings.find((h) => h.ticker.toUpperCase() === t);
  return found?.quantity ?? "0";
}

export function buildDividendsPageData(args: {
  received: ReceivedDividend[];
  upcoming: UpcomingDividend[];
  holdings: Array<{ ticker: string; quantity: string; instrumentName: string | null }>;
  cclRate: number | null;
  yahooErrors: string[];
}): DividendsPageData {
  const { received, upcoming, holdings, cclRate, yahooErrors } = args;

  let totalGrossArs = new Decimal(0);
  let totalTaxArs = new Decimal(0);
  let totalGrossUsd = new Decimal(0);
  let totalTaxUsd = new Decimal(0);

  const nowYear = new Date().getUTCFullYear();
  let ytdNetArs = new Decimal(0);
  let ytdNetUsd = new Decimal(0);
  let lastYearNetArs = new Decimal(0);
  let lastYearNetUsd = new Decimal(0);

  type TickerAgg = {
    ticker: string;
    instrumentName: string | null;
    payments: number;
    grossArs: Decimal;
    taxArs: Decimal;
    grossUsd: Decimal;
    taxUsd: Decimal;
  };
  type MonthAgg = {
    key: string;
    label: string;
    grossArs: Decimal;
    taxArs: Decimal;
    grossUsd: Decimal;
    taxUsd: Decimal;
  };

  const byTicker = new Map<string, TickerAgg>();
  const byMonth = new Map<string, MonthAgg>();

  for (const r of received) {
    const grossArs = toArs(r.grossAmount, r.currencyCode, cclRate);
    const taxArs = toArs(r.taxAmount, r.currencyCode, cclRate);
    const grossUsd = toUsd(r.grossAmount, r.currencyCode, cclRate);
    const taxUsd = toUsd(r.taxAmount, r.currencyCode, cclRate);

    totalGrossArs = totalGrossArs.plus(grossArs);
    totalTaxArs = totalTaxArs.plus(taxArs);
    totalGrossUsd = totalGrossUsd.plus(grossUsd);
    totalTaxUsd = totalTaxUsd.plus(taxUsd);

    const date = new Date(r.tradeDate);
    const year = date.getUTCFullYear();
    const key = monthKey(date);

    const ta = byTicker.get(r.ticker) ?? {
      ticker: r.ticker,
      instrumentName: r.instrumentName,
      payments: 0,
      grossArs: new Decimal(0),
      taxArs: new Decimal(0),
      grossUsd: new Decimal(0),
      taxUsd: new Decimal(0),
    };
    ta.payments += 1;
    ta.grossArs = ta.grossArs.plus(grossArs);
    ta.taxArs = ta.taxArs.plus(taxArs);
    ta.grossUsd = ta.grossUsd.plus(grossUsd);
    ta.taxUsd = ta.taxUsd.plus(taxUsd);
    byTicker.set(r.ticker, ta);

    const ma = byMonth.get(key) ?? {
      key,
      label: monthLabel(year, date.getUTCMonth() + 1),
      grossArs: new Decimal(0),
      taxArs: new Decimal(0),
      grossUsd: new Decimal(0),
      taxUsd: new Decimal(0),
    };
    ma.grossArs = ma.grossArs.plus(grossArs);
    ma.taxArs = ma.taxArs.plus(taxArs);
    ma.grossUsd = ma.grossUsd.plus(grossUsd);
    ma.taxUsd = ma.taxUsd.plus(taxUsd);
    byMonth.set(key, ma);

    const netArs = grossArs.minus(taxArs);
    const netUsd = grossUsd.minus(taxUsd);
    if (year === nowYear) {
      ytdNetArs = ytdNetArs.plus(netArs);
      ytdNetUsd = ytdNetUsd.plus(netUsd);
    } else if (year === nowYear - 1) {
      lastYearNetArs = lastYearNetArs.plus(netArs);
      lastYearNetUsd = lastYearNetUsd.plus(netUsd);
    }
  }

  let next30ArsTotal = new Decimal(0);
  let next30UsdTotal = new Decimal(0);
  const horizon30 = Date.now() + 30 * 24 * 60 * 60 * 1000;
  for (const u of upcoming) {
    if (new Date(u.estimatedDate).getTime() <= horizon30) {
      next30ArsTotal = next30ArsTotal.plus(toArs(u.estimatedTotal, u.currencyCode, cclRate));
      next30UsdTotal = next30UsdTotal.plus(toUsd(u.estimatedTotal, u.currencyCode, cclRate));
    }
  }

  const tickerRows: DividendByTicker[] = Array.from(byTicker.values())
    .map((t) => ({
      ticker: t.ticker,
      instrumentName: t.instrumentName,
      payments: t.payments,
      grossArs: t.grossArs.toFixed(2),
      taxArs: t.taxArs.toFixed(2),
      netArs: t.grossArs.minus(t.taxArs).toFixed(2),
      grossUsd: t.grossUsd.toFixed(2),
      taxUsd: t.taxUsd.toFixed(2),
      netUsd: t.grossUsd.minus(t.taxUsd).toFixed(2),
      currentQuantity: pickHoldingQuantity(holdings, t.ticker),
    }))
    .sort((a, b) => Number(b.netArs) - Number(a.netArs));

  const monthRows: DividendByMonth[] = Array.from(byMonth.values())
    .map((m) => ({
      key: m.key,
      label: m.label,
      grossArs: m.grossArs.toFixed(2),
      taxArs: m.taxArs.toFixed(2),
      netArs: m.grossArs.minus(m.taxArs).toFixed(2),
      grossUsd: m.grossUsd.toFixed(2),
      taxUsd: m.taxUsd.toFixed(2),
      netUsd: m.grossUsd.minus(m.taxUsd).toFixed(2),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const calendar: DividendMonth[] = [];
  const today = new Date();
  for (let offset = -6; offset <= 5; offset++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
    const key = monthKey(d);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    calendar.push({
      key,
      year,
      month,
      received: received
        .filter((r) => monthKey(new Date(r.tradeDate)) === key)
        .sort((a, b) => Number(b.netAmount) - Number(a.netAmount)),
      upcoming: upcoming
        .filter((u) => monthKey(new Date(u.estimatedDate)) === key)
        .sort((a, b) => a.estimatedDate.localeCompare(b.estimatedDate)),
    });
  }

  const topTicker = tickerRows[0]
    ? {
        ticker: tickerRows[0].ticker,
        netArs: tickerRows[0].netArs,
        netUsd: tickerRows[0].netUsd,
      }
    : null;

  const effectiveTaxRate = totalGrossArs.isZero()
    ? "0.00"
    : totalTaxArs.div(totalGrossArs).mul(100).toFixed(2);

  const kpis: DividendKpis = {
    totalGrossArs: totalGrossArs.toFixed(2),
    totalTaxArs: totalTaxArs.toFixed(2),
    totalNetArs: totalGrossArs.minus(totalTaxArs).toFixed(2),
    totalGrossUsd: totalGrossUsd.toFixed(2),
    totalTaxUsd: totalTaxUsd.toFixed(2),
    totalNetUsd: totalGrossUsd.minus(totalTaxUsd).toFixed(2),
    effectiveTaxRate,
    topTicker,
    totalPayments: received.length,
    ytdNetArs: ytdNetArs.toFixed(2),
    ytdNetUsd: ytdNetUsd.toFixed(2),
    lastYearNetArs: lastYearNetArs.toFixed(2),
    lastYearNetUsd: lastYearNetUsd.toFixed(2),
    next30dEstimatedArs: next30ArsTotal.toFixed(2),
    next30dEstimatedUsd: next30UsdTotal.toFixed(2),
  };

  return {
    kpis,
    byTicker: tickerRows,
    byMonth: monthRows,
    calendar,
    received: received.slice().sort((a, b) => b.tradeDate.localeCompare(a.tradeDate)),
    upcoming,
    cclRate: cclRate ? cclRate.toFixed(2) : null,
    yahooErrors,
  };
}
