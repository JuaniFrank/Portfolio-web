export type ViewCurrency = "ARS" | "USD";

export function formatMoney(value: string | number, currency: ViewCurrency): string {
  const n = typeof value === "number" ? value : Number(value);
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "USD" ? 2 : 2,
  });
}

export function formatNumber(value: string | number, digits = 0): string {
  const n = typeof value === "number" ? value : Number(value);
  return n.toLocaleString("es-AR", { maximumFractionDigits: digits });
}

export function formatPercent(value: string | number, digits = 2): string {
  const n = typeof value === "number" ? value : Number(value);
  return `${n.toLocaleString("es-AR", { maximumFractionDigits: digits })}%`;
}

const MONTHS_LONG = [
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

export function monthName(month: number): string {
  return MONTHS_LONG[month - 1] ?? "";
}

export function formatDayMonth(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatFullDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", { year: "numeric", month: "short", day: "2-digit" });
}
