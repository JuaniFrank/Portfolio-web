/**
 * Curated corporate events that the app can suggest applying with one click.
 *
 * These are well-known Argentine CEDEAR/instrument corporate actions whose exact
 * parameters are public and stable. The recommendation UI surfaces one only when
 * the user actually holds the instrument AND has not already recorded a matching
 * CorporateEvent. Applying a recommendation just creates a normal CorporateEvent —
 * the adjustment itself always happens at holdings-aggregation time.
 */

import { CorporateEventType, InstrumentType } from "@/lib/generated/prisma";

export type RecommendedEvent = {
  /** Ticker matched against the user's portfolio instruments (case-insensitive). */
  ticker: string;
  /**
   * Instrument type this ticker is listed under. Needed by the seed, which has
   * to resolve the instrument row before writing the event — not every known
   * corporate action belongs to a CEDEAR (YPFD is a local STOCK_AR).
   */
  instrumentType: InstrumentType;
  eventType: CorporateEventType;
  /** YYYY-MM-DD */
  effectiveDate: string;
  numerator: string;
  denominator: string;
  /** Persisted onto the created event. */
  notes: string;
  /** Card heading. */
  title: string;
  /** Card body copy. */
  description: string;
};

export const RECOMMENDED_EVENTS: RecommendedEvent[] = [
  {
    ticker: "SPY",
    instrumentType: InstrumentType.CEDEAR,
    eventType: CorporateEventType.CEDEAR_RATIO_CHANGE,
    effectiveDate: "2026-06-01",
    numerator: "3",
    denominator: "1",
    notes: "Cambio de ratio CEDEAR SPY de 20:1 a 60:1 (01/06/2026).",
    title: "Cambio de ratio — SPY",
    description:
      "El CEDEAR de SPY pasó de 20:1 a 60:1 el 01/06/2026. Las operaciones anteriores a esa fecha se ajustan ×3 en cantidad (y el precio se divide por 3). El importe pagado no cambia.",
  },
  {
    ticker: "YPFD",
    instrumentType: InstrumentType.STOCK_AR,
    eventType: CorporateEventType.STOCK_SPLIT,
    effectiveDate: "2026-08-03",
    numerator: "10",
    denominator: "1",
    notes: "Split 10:1 de YPF (03/08/2026).",
    title: "Split 10:1 — YPFD",
    description:
      "YPF hizo un split 10:1 el 03/08/2026. Las operaciones anteriores a esa fecha se ajustan ×10 en cantidad (y el precio se divide por 10). El importe pagado no cambia.",
  },
];

export type ApplicableRecommendation = RecommendedEvent & {
  instrumentId: string;
  instrumentName: string;
};

type InstrumentLike = { id: string; ticker: string; name: string };
type ExistingEventLike = {
  instrumentId: string;
  effectiveDate: string;
  eventType: string;
};

/**
 * Resolve which recommended events apply to this user right now: the instrument
 * is in their portfolio and no matching event (same instrument, date and type)
 * has been recorded yet.
 */
export function resolveApplicableRecommendations(
  instruments: InstrumentLike[],
  existingEvents: ExistingEventLike[]
): ApplicableRecommendation[] {
  const applicable: ApplicableRecommendation[] = [];

  for (const rec of RECOMMENDED_EVENTS) {
    const instrument = instruments.find(
      (i) => i.ticker.toUpperCase() === rec.ticker.toUpperCase()
    );
    if (!instrument) continue; // user does not hold it

    const alreadyRecorded = existingEvents.some(
      (e) =>
        e.instrumentId === instrument.id &&
        e.effectiveDate === rec.effectiveDate &&
        e.eventType === rec.eventType
    );
    if (alreadyRecorded) continue;

    applicable.push({
      ...rec,
      instrumentId: instrument.id,
      instrumentName: instrument.name,
    });
  }

  return applicable;
}
