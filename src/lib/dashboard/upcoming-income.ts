/**
 * "Próximos cobros" — próximos 30/60/90 días de cupones, amortizaciones de ONs
 * y dividendos estimados, unificados en una sola lista ordenada por fecha.
 *
 * Pura: no toca Prisma ni hace fetch. Los flujos de ON llegan ya futuros y
 * escalados a la tenencia real (`BondCashflowEntry.flows`, ver
 * `src/lib/bonds/cashflows.ts`); igual se filtra por fecha acá para no
 * asumir esa garantía del caller (defensivo, no redundante: un caller que
 * pase flujos sin filtrar no debería colar el pasado).
 */
import Decimal from "decimal.js";
import { toArsAndUsd, type BondCashflowEntry } from "@/lib/bonds/cashflows";
import type { UpcomingDividend } from "@/lib/dividends/types";

export type UpcomingIncomeKind = "coupon" | "amortization" | "dividend";

export type UpcomingIncomeRow = {
  /** Fecha ISO (YYYY-MM-DD) del cobro. */
  date: string;
  /** Días desde `today` hasta `date` (0 = hoy, siempre >= 0). */
  daysUntil: number;
  ticker: string;
  kind: UpcomingIncomeKind;
  /**
   * Los cupones/amortizaciones de ONs son contractuales (`false`); los
   * dividendos son siempre una proyección por cadencia histórica (`true`).
   */
  estimated: boolean;
  /** `null` cuando no hay CCL para convertir un monto en moneda extranjera. */
  amountArs: string | null;
  amountUsd: string | null;
};

export type UpcomingIncomeBucketTotal = {
  ars: string;
  usd: string;
};

export type UpcomingIncomeTotals = {
  d30: UpcomingIncomeBucketTotal;
  d60: UpcomingIncomeBucketTotal;
  d90: UpcomingIncomeBucketTotal;
};

export type UpcomingIncomeResult = {
  rows: UpcomingIncomeRow[];
  totals: UpcomingIncomeTotals;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(today: Date, target: Date): number {
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const targetUtc = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((targetUtc - todayUtc) / MS_PER_DAY);
}

function buildBucketTotals(rows: UpcomingIncomeRow[]): UpcomingIncomeTotals {
  const bucket = (maxDays: number): UpcomingIncomeBucketTotal => {
    let ars = new Decimal(0);
    let usd = new Decimal(0);
    for (const row of rows) {
      if (row.daysUntil > maxDays) continue;
      if (row.amountArs !== null) ars = ars.plus(row.amountArs);
      if (row.amountUsd !== null) usd = usd.plus(row.amountUsd);
    }
    return { ars: ars.toFixed(2), usd: usd.toFixed(2) };
  };

  return { d30: bucket(30), d60: bucket(60), d90: bucket(90) };
}

export function buildUpcomingIncome({
  bondEntries,
  dividendEstimates,
  cclRate,
  today = new Date(),
}: {
  bondEntries: BondCashflowEntry[];
  dividendEstimates: UpcomingDividend[];
  cclRate: number | null;
  today?: Date;
}): UpcomingIncomeResult {
  const rows: UpcomingIncomeRow[] = [];

  for (const entry of bondEntries) {
    for (const flow of entry.flows) {
      const flowDate = new Date(flow.date);
      const daysUntil = daysBetween(today, flowDate);
      if (daysUntil < 0) continue;

      const { arsAmount, usdAmount } = toArsAndUsd(flow.amount, entry.currencyCode, cclRate);
      rows.push({
        date: flow.date.slice(0, 10),
        daysUntil,
        ticker: entry.ticker,
        kind: flow.flowType === "COUPON" ? "coupon" : "amortization",
        estimated: false,
        amountArs: arsAmount?.toFixed(2) ?? null,
        amountUsd: usdAmount?.toFixed(2) ?? null,
      });
    }
  }

  for (const dividend of dividendEstimates) {
    const flowDate = new Date(dividend.estimatedDate);
    const daysUntil = daysBetween(today, flowDate);
    if (daysUntil < 0) continue;

    const { arsAmount, usdAmount } = toArsAndUsd(
      Number(dividend.estimatedTotal),
      dividend.currencyCode,
      cclRate
    );
    rows.push({
      date: dividend.estimatedDate.slice(0, 10),
      daysUntil,
      ticker: dividend.ticker,
      kind: "dividend",
      estimated: true,
      amountArs: arsAmount?.toFixed(2) ?? null,
      amountUsd: usdAmount?.toFixed(2) ?? null,
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.ticker.localeCompare(b.ticker));

  return { rows, totals: buildBucketTotals(rows) };
}
