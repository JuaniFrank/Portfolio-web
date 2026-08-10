export function formatDateTick(value: string): string {
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", timeZone: "UTC" })
    .format(new Date(value))
    .replace(".", "");
}

export function formatDateLong(value: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(value))
    .replace(".", "");
}

export function formatPercentValue(value: number): string {
  return `${value.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
}

export function formatSignedPercentValue(value: number): string {
  return `${value >= 0 ? "+" : ""}${formatPercentValue(value)}%`;
}
