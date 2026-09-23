/**
 * Overlay en memoria de precios y CCL "en vivo" sobre las series EOD del replay.
 *
 * **Módulo puro**: recibe las filas ya leídas de la DB y las cotizaciones en vivo ya
 * resueltas, y no sabe de Prisma ni de fetch. "Hoy" se inyecta para que sea testeable.
 *
 * Por qué en memoria y no persistido: escribir el precio en vivo como fila `yahoo-eod`
 * contaminaría el histórico con un dato intradiario que `history-sync.ts` asume que
 * nunca existe (ver `EOD_PRICE_SOURCE`). El overlay resuelve el mismo problema sin tocar
 * esa invariante — el cron nocturno reemplaza el punto en vivo por el cierre medido en
 * cuanto corre, así que el EOD siempre gana cuando está presente.
 */

import { isTradingWeekday } from "./market-day";
import { toUtcDay } from "./months";
import type { SeriesPoint } from "./price-series";

/** Fila de precio EOD, en la forma que ya arma `PriceIndex`. */
export type EodPriceRow = { instrumentId: string; date: Date; close: number };

/** Cotización en vivo ya matcheada a un instrumento concreto. */
export type LivePriceQuote = { instrumentId: string; price: number | null };

export type PriceOverlayResult = {
  rows: EodPriceRow[];
  /** Instrumentos cuyo punto de hoy vino del overlay, no de un cierre medido. */
  liveInstrumentIds: Set<string>;
};

function isUsableQuote(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

/**
 * Agrega un punto de hoy con el precio en vivo para cada instrumento que no tenga ya
 * una fila EOD fechada hoy. El EOD gana siempre que exista.
 */
export function overlayLivePrices(
  rows: EodPriceRow[],
  liveQuotes: LivePriceQuote[],
  today: Date
): PriceOverlayResult {
  const todayUtc = toUtcDay(today);
  const todayTime = todayUtc.getTime();

  // Sin rueda no hay precio en vivo: data912 repite el cierre del viernes y sumarlo
  // agregaría un día de mercado que no existió.
  if (!isTradingWeekday(todayUtc)) return { rows, liveInstrumentIds: new Set() };

  const instrumentsWithEodToday = new Set(
    rows.filter((row) => toUtcDay(row.date).getTime() === todayTime).map((row) => row.instrumentId)
  );

  const liveInstrumentIds = new Set<string>();
  const overlayRows: EodPriceRow[] = [];

  for (const quote of liveQuotes) {
    if (instrumentsWithEodToday.has(quote.instrumentId)) continue; // el EOD gana
    if (!isUsableQuote(quote.price)) continue;
    if (liveInstrumentIds.has(quote.instrumentId)) continue; // dedupe: gana el primero

    liveInstrumentIds.add(quote.instrumentId);
    overlayRows.push({ instrumentId: quote.instrumentId, date: todayUtc, close: quote.price });
  }

  if (overlayRows.length === 0) return { rows, liveInstrumentIds };
  return { rows: [...rows, ...overlayRows], liveInstrumentIds };
}

export type CclOverlayResult = {
  points: SeriesPoint[];
  /** `true` cuando el punto de hoy vino del overlay en vivo. */
  isLive: boolean;
};

/** Igual criterio que `overlayLivePrices`, pero para la serie de CCL, que es única. */
export function overlayLiveCcl(
  points: SeriesPoint[],
  liveMid: number | null,
  today: Date
): CclOverlayResult {
  const todayUtc = toUtcDay(today);
  const todayTime = todayUtc.getTime();

  if (!isTradingWeekday(todayUtc)) return { points, isLive: false };

  const hasToday = points.some((point) => toUtcDay(point.date).getTime() === todayTime);
  if (hasToday) return { points, isLive: false };
  if (!isUsableQuote(liveMid)) return { points, isLive: false };

  return { points: [...points, { date: todayUtc, value: liveMid }], isLive: true };
}
