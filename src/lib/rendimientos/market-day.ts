/**
 * El "hoy" de un mercado. **Módulo puro**.
 *
 * Toda la base guarda los días como medianoche UTC, pero *qué* día es se decide con el
 * calendario del mercado, no con el de UTC ni con el del usuario. Truncar `new Date()`
 * en UTC hace que entre las 21:00 y las 24:00 de Buenos Aires el precio en vivo del
 * lunes quede fechado martes; usar la zona del usuario reintroduce el mismo corrimiento
 * para alguien que mira BYMA desde otro huso. La cotización pertenece a la rueda del
 * mercado donde se operó.
 *
 * La zona es un parámetro para cuando entren mercados con otro calendario (por ejemplo
 * `America/New_York` para acciones de EE.UU.).
 */

/** Calendario de BYMA, el único mercado que valúa hoy el motor de rendimientos. */
export const DEFAULT_MARKET_TIME_ZONE = "America/Argentina/Buenos_Aires";

/** Medianoche UTC del día calendario que `instant` es en `timeZone`. */
export function marketDayOf(instant: Date, timeZone: string = DEFAULT_MARKET_TIME_ZONE): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)!.value);

  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}

/**
 * ¿`day` (medianoche UTC) cae de lunes a viernes? No conoce feriados: un feriado con
 * precio en vivo agrega un punto igual al cierre anterior, que no mueve la valuación.
 */
export function isTradingWeekday(day: Date): boolean {
  const weekday = day.getUTCDay();
  return weekday !== 0 && weekday !== 6;
}
