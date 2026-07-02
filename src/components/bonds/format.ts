export type ViewCurrency = "ARS" | "USD";

export function formatMoney(value: string | number | null, currency: ViewCurrency): string {
  if (value === null) return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  });
}

export function formatNumber(value: string | number, digits = 0): string {
  const n = typeof value === "number" ? value : Number(value);
  return n.toLocaleString("es-AR", { maximumFractionDigits: digits });
}

export function formatPercent(value: string | number | null, digits = 2): string {
  if (value === null) return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toLocaleString("es-AR", { maximumFractionDigits: digits })}%`;
}

export function formatFullDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-AR", { year: "numeric", month: "short", day: "2-digit" });
}
