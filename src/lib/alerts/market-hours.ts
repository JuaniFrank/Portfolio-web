/**
 * Ventanas de operación de los mercados que cubren las alertas. El worker las usa para
 * no consultar precios con todo cerrado. El reloj se inyecta (`now`) y el horario de
 * verano lo resuelve `Intl` por zona horaria, no con offsets fijos.
 *
 * No contempla feriados: un feriado hace una consulta de más, nunca una alerta de menos.
 */

type Window = {
  timeZone: string;
  /** Minutos desde la medianoche local. */
  openMinute: number;
  closeMinute: number;
};

/** BYMA: 11:00 a 17:00, lunes a viernes. */
const BYMA: Window = { timeZone: "America/Argentina/Buenos_Aires", openMinute: 11 * 60, closeMinute: 17 * 60 };
/** NYSE / Nasdaq: 9:30 a 16:00, lunes a viernes. */
const US: Window = { timeZone: "America/New_York", openMinute: 9 * 60 + 30, closeMinute: 16 * 60 };

const WEEKDAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

export type MarketsOpen = { byma: boolean; us: boolean; anyOpen: boolean };

function isOpen(now: Date, window: Window): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: window.timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  if (!WEEKDAYS.has(get("weekday"))) return false;

  const minute = Number(get("hour")) * 60 + Number(get("minute"));
  return minute >= window.openMinute && minute < window.closeMinute;
}

export function marketsOpenAt(now: Date): MarketsOpen {
  const byma = isOpen(now, BYMA);
  const us = isOpen(now, US);
  return { byma, us, anyOpen: byma || us };
}
