/**
 * Sector resolution shared by the dashboard (`allocationBySector`) and
 * `/rendimientos` (return attribution "Por sector"): a 3-step fallback over
 * the raw sector fields (AD-3 design §2.3) followed by a translation/synthesis
 * step for instruments that don't carry a Yahoo sector at all (ONs, FCIs,
 * crypto, ETFs).
 *
 * Extracted from `src/lib/dashboard/build.ts` (`translateSector`, previously
 * unexported) and the inline fallback in `src/app/actions/dashboard.ts` so
 * both callers — and now `series.ts` for the attribution card — share one
 * implementation instead of two copies drifting apart.
 */
import type { InstrumentType } from "@/lib/generated/prisma";

const SECTOR_ES: Record<string, string> = {
  // Yahoo Finance — 11 sectores actuales
  Technology: "Tecnología",
  "Financial Services": "Servicios financieros",
  Industrials: "Industria",
  Healthcare: "Salud",
  "Communication Services": "Comunicación",
  "Consumer Cyclical": "Consumo cíclico",
  Energy: "Energía",
  "Consumer Defensive": "Consumo defensivo",
  "Basic Materials": "Materiales básicos",
  "Real Estate": "Inmobiliario",
  Utilities: "Servicios públicos",

  // Variantes / nombres históricos / aliases
  Financials: "Servicios financieros",
  Finance: "Servicios financieros",

  "Consumer Discretionary": "Consumo cíclico",
  "Consumer Staples": "Consumo defensivo",

  "Health Care": "Salud",
  "Health Care Services": "Salud",

  Communications: "Comunicación",

  Materials: "Materiales básicos",

  "Real Estate Investment Trusts": "Inmobiliario",
};

export type RawSectorFields = {
  /** `Instrument.sector` (Yahoo, when known directly). */
  instrumentSector: string | null;
  /** `Instrument.baseInstrument?.sector` — e.g. a CEDEAR's underlying US stock. */
  baseInstrumentSector?: string | null;
  /** `Instrument.underlyingAsset?.sector` — the AD-3 catch-all. */
  underlyingAssetSector?: string | null;
};

/**
 * 3-step fallback (AD-3 design §2.3): `instrument.sector ??
 * baseInstrument.sector ?? underlyingAsset.sector ?? null`.
 */
export function resolveRawSector(fields: RawSectorFields): string | null {
  return fields.instrumentSector ?? fields.baseInstrumentSector ?? fields.underlyingAssetSector ?? null;
}

/**
 * Translates a raw sector to Spanish when known, passes through an
 * unrecognized-but-present raw sector as-is, and otherwise synthesizes a
 * sector from the instrument type for instruments Yahoo never sectorizes
 * (ONs, letras, FCIs, crypto, ETFs) — falling back to "Sin clasificar".
 */
export function translateSector(raw: string | null, instrumentType: InstrumentType): string {
  if (raw && SECTOR_ES[raw]) return SECTOR_ES[raw]!;
  if (raw && raw.trim().length > 0) return raw;
  if (instrumentType === "ETF") return "ETF";
  if (instrumentType === "BOND_AR" || instrumentType === "LETRA" || instrumentType === "ON") {
    return "Renta fija";
  }
  if (instrumentType === "FCI") return "Fondos comunes";
  if (instrumentType === "CRYPTO" || instrumentType === "STABLECOIN") return "Cripto";
  return "Sin clasificar";
}

/** Convenience: fallback + translate in one call. */
export function resolveSector(fields: RawSectorFields, instrumentType: InstrumentType): string {
  return translateSector(resolveRawSector(fields), instrumentType);
}
