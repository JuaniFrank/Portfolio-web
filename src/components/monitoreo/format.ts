export function formatCurrency(
  value: number | null | undefined,
  currency: "ARS" | "USD" = "ARS"
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  const prefix = currency === "USD" ? "US$ " : "$ ";
  return `${prefix}${value.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }

  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

export function formatTradingDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  // dateStr is YYYY-MM-DD
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

export function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return "—";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 2 })}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })}K`;
  }

  return value.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}
