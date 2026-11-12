import { adrSymbolFor } from "@/lib/market/adr-map";
import type { InstrumentType } from "@/lib/generated/prisma";
import type { MonitoringCurrency, UiMonitoringSeriesKind } from "@/lib/monitoreo/types";

/** Which price the user thinks in when simulating: the local ARS one or the USD counterpart. */
export type PriceBasis = "ars" | "usd";

export type BasisOption = {
  basis: PriceBasis;
  /** Series kind whose quote is this basis' market price */
  kind: UiMonitoringSeriesKind;
  currency: MonitoringCurrency;
  label: string;
  /** "por CEDEAR", "por acción original", ... */
  unitLabel: string;
  /** Live quote in this basis; falls back to the last close only for the chart-matching basis */
  marketPrice: number | null;
  /** chart-scale price per basis price (embeds ratio and FX); null when it cannot be computed */
  factor: number | null;
  available: boolean;
};

export function defaultBasis(kind: UiMonitoringSeriesKind): PriceBasis {
  return kind === "cedear-underlying" || kind === "adr" ? "usd" : "ars";
}

const isPositive = (n: number | null | undefined): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;

type Instrument = { type: InstrumentType; ticker: string };

function usdKind(instrument: Instrument): UiMonitoringSeriesKind | null {
  if (instrument.type === "CEDEAR") return "cedear-underlying";
  if (instrument.type === "STOCK_AR" && adrSymbolFor(instrument.ticker)) return "adr";
  return null;
}

/**
 * Bases the simulator can price in, with the factor that brings a basis price to the chart scale
 * of the active view. `quotes` holds live prices by series kind; the theoretical CEDEAR view has
 * no quote, so the series' last close is its reference.
 */
export function resolveBasisOptions(input: {
  instrument: Instrument;
  chartKind: UiMonitoringSeriesKind;
  quotes: Partial<Record<UiMonitoringSeriesKind, number | null>>;
  chartLastClose: number | null;
}): BasisOption[] {
  const { instrument, chartKind, quotes, chartLastClose } = input;
  const usd = usdKind(instrument);
  if (!usd) return [];

  const isCedear = instrument.type === "CEDEAR";
  const chartRef = chartKind === "cedear-theoretical" ? chartLastClose : (quotes[chartKind] ?? null);
  const matching = defaultBasis(chartKind);

  const build = (
    basis: PriceBasis,
    kind: UiMonitoringSeriesKind,
    label: string,
    unitLabel: string
  ): BasisOption => {
    const quote = quotes[kind] ?? null;
    const marketPrice = isPositive(quote) ? quote : basis === matching ? chartLastClose : null;
    let factor: number | null = null;
    if (kind === chartKind) factor = 1;
    else if (isPositive(chartRef) && isPositive(quote)) factor = chartRef / quote;
    return {
      basis,
      kind,
      currency: basis === "usd" ? "USD" : "ARS",
      label,
      unitLabel,
      marketPrice,
      factor,
      available: factor !== null,
    };
  };

  return [
    build("ars", "native", isCedear ? "CEDEAR (ARS)" : "Local (ARS)", isCedear ? "por CEDEAR" : "por acción local"),
    build("usd", usd, isCedear ? "Acción original (USD)" : "ADR (USD)", isCedear ? "por acción original" : "por ADR"),
  ];
}

/**
 * Pesos (the instrument's own currency) per chart-scale unit of price: `nativePrice = chartPrice ×
 * moneyFactor`. USD views price an underlying/ADR share while quantity counts CEDEARs or local
 * shares, so qty × chartPrice is not money there; the native quote over the chart quote fixes
 * the scale. 1 on the native view; null when a quote (or the theoretical reference) is missing.
 */
export function moneyFactor(
  chartKind: UiMonitoringSeriesKind,
  quotes: Partial<Record<UiMonitoringSeriesKind, number | null>>,
  chartLastClose: number | null = null
): number | null {
  if (chartKind === "native") return 1;
  const native = quotes.native;
  // The theoretical CEDEAR view has no quote of its own: the series' last close is its reference
  // (same as the theoretical basis factor), so the CEDEAR premium is part of the money scale.
  const chart = chartKind === "cedear-theoretical" ? chartLastClose : quotes[chartKind];
  return isPositive(native) && isPositive(chart) ? native / chart : null;
}

export const toChartPrice = (basisPrice: number, factor: number): number => basisPrice * factor;
export const toBasisPrice = (chartPrice: number, factor: number): number => chartPrice / factor;

/** Re-expresses a price from one basis in another, through their chart-scale factors. */
export function convertBasisPrice(
  price: number,
  fromFactor: number | null,
  toFactor: number | null
): number | null {
  if (!isPositive(fromFactor) || !isPositive(toFactor)) return null;
  return (price * fromFactor) / toFactor;
}
