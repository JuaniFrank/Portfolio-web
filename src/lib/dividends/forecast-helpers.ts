import type { InstrumentType } from "@/lib/generated/prisma";
import { isUsdCurrency } from "@/lib/rendimientos/cashflows";
import type { DividendCurrency } from "./types";

/** Currency Yahoo reports for a dividend series, normalized to the two we display. */
export function pickCurrency(meta: string | null): DividendCurrency {
  if (!meta) return "ARS";
  return isUsdCurrency(meta) ? "USD" : "ARS";
}

/**
 * Types quoted on BYMA (`.BA` suffix on Yahoo). Includes CEDEAR on purpose: the plain
 * US symbol reports the dividend per US *share*, but the holding quantity counts
 * CEDEARs, and without the ratio that overstates the forecast by the ratio (e.g. 20x).
 * The `.BA` line is already per CEDEAR.
 */
const BYMA_QUOTED_TYPES = new Set<InstrumentType>([
  "CEDEAR",
  "STOCK_AR",
  "BOND_AR",
  "LETRA",
  "ON",
]);

export function isBymaQuoted(type: InstrumentType): boolean {
  return BYMA_QUOTED_TYPES.has(type);
}
