/**
 * Trade-date conventions for manual entry. Imports store the settlement day at 12:00Z
 * (`balanz.analyzer.ts`), and the position replay sorts by timestamp, so a manual trade
 * at 00:00Z would be processed before an imported trade of the same day (a same-day
 * SELL could run before its BUY). Noon UTC also keeps the calendar day stable for any
 * viewer between UTC-12 and UTC+11.
 */

const STORAGE_HOUR_UTC = 12;

/** `YYYY-MM-DD` (already validated) -> instant to persist. */
export function tradeDateToStorage(isoDay: string): Date {
  return new Date(`${isoDay}T${String(STORAGE_HOUR_UTC).padStart(2, "0")}:00:00.000Z`);
}

/** Persisted instant -> value for `<input type="date">`. Reads the UTC day on purpose. */
export function tradeDateToInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar day for the user's timezone (not UTC), for the form default. */
export function localTodayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
