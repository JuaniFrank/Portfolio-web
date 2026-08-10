/**
 * Utilidades de calendario mensual. **Módulo puro**, todo en UTC.
 *
 * Todo el motor trabaja en UTC a propósito. Las fechas de operación y los precios
 * EOD se guardan a medianoche UTC, y mezclar husos haría que una operación del 31 a
 * la noche caiga en el mes siguiente según dónde esté corriendo el server. Un bug
 * así solo aparece en producción y solo algunos días del mes.
 */

/** Clave de mes en formato `"YYYY-MM"`. */
export type MonthKey = string;

export function monthKey(date: Date): MonthKey {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function parseMonthKey(key: MonthKey): { year: number; monthIndex: number } {
  const [yearText, monthText] = key.split("-");
  return { year: Number(yearText), monthIndex: Number(monthText) - 1 };
}

/** Medianoche UTC del primer día del mes. */
export function monthStart(key: MonthKey): Date {
  const { year, monthIndex } = parseMonthKey(key);
  return new Date(Date.UTC(year, monthIndex, 1));
}

/** Medianoche UTC del último día del mes. */
export function monthEnd(key: MonthKey): Date {
  const { year, monthIndex } = parseMonthKey(key);
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

export function daysInMonth(key: MonthKey): number {
  return monthEnd(key).getUTCDate();
}

/** Mes anterior a `key`. */
export function previousMonth(key: MonthKey): MonthKey {
  const { year, monthIndex } = parseMonthKey(key);
  return monthKey(new Date(Date.UTC(year, monthIndex - 1, 1)));
}

/** Día del mes de una fecha, 1-based — el `d_i` de Modified Dietz. */
export function dayOfMonth(date: Date): number {
  return date.getUTCDate();
}

/**
 * Lista de meses consecutivos entre dos fechas, ambos extremos incluidos.
 * Devuelve `[]` si el rango está invertido.
 */
export function enumerateMonths(from: Date, to: Date): MonthKey[] {
  if (from.getTime() > to.getTime()) return [];

  const months: MonthKey[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const limit = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

  while (cursor.getTime() <= limit.getTime()) {
    months.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return months;
}

/** Etiqueta corta para la UI: `"2026-08"` → `"08/2026"`. */
export function formatMonthLabel(key: MonthKey): string {
  const [year, month] = key.split("-");
  return `${month}/${year}`;
}

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

/** Etiqueta larga para tooltips: `"2026-08"` → `"Agosto 2026"`. */
export function formatMonthLong(key: MonthKey): string {
  const { year, monthIndex } = parseMonthKey(key);
  return `${MONTH_NAMES[monthIndex] ?? key} ${year}`;
}
