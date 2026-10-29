/**
 * Precio diario de ONs para los replays (gráfico de evolución y `/rendimientos`).
 *
 * data912 cotiza las ONs ARS por 100 VN, y no hay cierres EOD históricos: se usa el
 * snapshot real del día cuando existe y, si no, el valor técnico estimado (residual ×
 * USD 1 × CCL). Todo el cálculo vive en `buildBondDailyPriceSeries`; este módulo solo
 * arma sus insumos por instrumento y devuelve las filas listas para un `PriceIndex`
 * más los días estimados que alimentan `PositionDetail.priceEstimated`.
 *
 * Es puro: las queries (`on-daily-prices-loader.ts`) quedan en los orquestadores.
 */

import {
  buildBondDailyPriceSeries,
  type BondRealSnapshot,
  type BondResidualRow,
} from "@/lib/dashboard/bond-price-series";
import type { TimeSeries } from "@/lib/rendimientos/price-series";
import type { BondTermsForProjection } from "./cashflows";
import {
  resolveBondSchedule,
  type BondScheduleRow,
  type StoredBondSchedule,
} from "./schedule-source";

type DecimalLike = number | { toNumber(): number };

export type OnSnapshotRow = {
  instrumentId: string;
  datetime: Date;
  close: DecimalLike;
};

export type OnTermsRow = {
  id: string;
  bondTerms: {
    faceValue: { toString(): string };
    currencyCode: string;
    rateType: string;
    couponRate: { toString(): string };
    couponFrequencyMonths: number;
    issueDate: Date;
    maturityDate: Date;
    amortizationSchedule: unknown;
    dayCountConvention: string;
  } | null;
  bondSchedule: { rows: unknown } | null;
};

export type OnPriceRow = { instrumentId: string; date: Date; close: number };

export type OnDailyPrices = {
  priceRows: OnPriceRow[];
  /** Días (UTC ms) marcados como valor técnico estimado, por instrumento. */
  estimatedPriceDays: Map<string, Set<number>>;
};

const toNumber = (value: DecimalLike): number =>
  typeof value === "number" ? value : value.toNumber();

export function buildOnDailyPrices(params: {
  instrumentIds: string[];
  snapshotRows: OnSnapshotRow[];
  termsRows: OnTermsRow[];
  /** Las ruedas a cubrir: los días en que cerró renta variable. */
  tradingDays: Date[];
  ccl: TimeSeries;
  today: Date;
}): OnDailyPrices {
  const { instrumentIds, snapshotRows, termsRows, tradingDays, ccl, today } = params;

  const snapshotsByInstrument = new Map<string, BondRealSnapshot[]>();
  for (const row of snapshotRows) {
    const list = snapshotsByInstrument.get(row.instrumentId) ?? [];
    list.push({ datetime: row.datetime, close: toNumber(row.close) });
    snapshotsByInstrument.set(row.instrumentId, list);
  }
  const termsById = new Map(termsRows.map((row) => [row.id, row]));

  const priceRows: OnPriceRow[] = [];
  const estimatedPriceDays = new Map<string, Set<number>>();

  for (const instrumentId of instrumentIds) {
    const row = termsById.get(instrumentId);

    const terms: BondTermsForProjection | null = row?.bondTerms
      ? {
          faceValue: row.bondTerms.faceValue.toString(),
          currencyCode: row.bondTerms.currencyCode,
          rateType: row.bondTerms.rateType as "FIXED" | "FLOATING",
          couponRate: row.bondTerms.couponRate.toString(),
          couponFrequencyMonths: row.bondTerms.couponFrequencyMonths,
          issueDate: row.bondTerms.issueDate,
          maturityDate: row.bondTerms.maturityDate,
          amortizationSchedule: row.bondTerms.amortizationSchedule,
          dayCountConvention: row.bondTerms.dayCountConvention,
        }
      : null;

    const storedSchedule: StoredBondSchedule | null = row?.bondSchedule
      ? { rows: row.bondSchedule.rows as unknown as BondScheduleRow[] }
      : null;

    const resolved = resolveBondSchedule(storedSchedule, terms, today);

    // El caso "derived" (sin `BondSchedule` guardado, proyectado desde `BondTerms`)
    // solo trae los flujos FUTUROS desde `today`: no alcanza para reconstruir el
    // residual de todo el histórico, así que se asume par completo (100, sin
    // amortizar) para esos días — una simplificación deliberada. Las dos ONs reales de
    // este dashboard (EAC4O, MCC3O) tienen `BondSchedule` guardado y siempre resuelven
    // a "docta-schedule", así que no las afecta; un ON sin schedule guardado ni
    // `BondTerms` ("none") cae en el mismo residual completo.
    const schedule: BondResidualRow[] =
      resolved.source === "docta-schedule"
        ? resolved.rows.map((r) => ({ paymentDate: r.paymentDate, residualValue: r.residualValue }))
        : [];

    const dailyPrices = buildBondDailyPriceSeries({
      days: tradingDays,
      snapshots: snapshotsByInstrument.get(instrumentId) ?? [],
      schedule,
      ccl,
    });

    const estimatedDays = new Set<number>();
    for (const point of dailyPrices) {
      const date = new Date(`${point.date}T00:00:00.000Z`);
      priceRows.push({ instrumentId, date, close: point.priceArsPerVn });
      if (point.estimated) estimatedDays.add(date.getTime());
    }
    if (estimatedDays.size > 0) estimatedPriceDays.set(instrumentId, estimatedDays);
  }

  return { priceRows, estimatedPriceDays };
}
