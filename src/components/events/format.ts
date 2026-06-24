import type { CorporateEventType } from "@/lib/generated/prisma";

/** Format ratio as "N:D" string, e.g. "3:1". */
export function formatRatio(numerator: string, denominator: string): string {
  return `${numerator}:${denominator}`;
}

/** Human-readable Spanish label for each event type. */
export function formatEventTypeLabel(type: CorporateEventType): string {
  switch (type) {
    case "CEDEAR_RATIO_CHANGE":
      return "Ratio CEDEAR";
    case "STOCK_SPLIT":
      return "Split";
    case "REVERSE_SPLIT":
      return "Reverse Split";
    case "SPINOFF":
      return "Spin-off";
    case "MERGER":
      return "Fusión";
    case "TICKER_CHANGE":
      return "Cambio de ticker";
    default:
      return type;
  }
}
