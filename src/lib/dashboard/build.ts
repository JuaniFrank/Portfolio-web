import Decimal from "decimal.js";
import type { InstrumentType } from "@/lib/generated/prisma";
import { EMPTY_EVOLUTION, type PortfolioEvolution } from "./evolution";
import type {
  AllocationSlice,
  ConcentrationStats,
  DashboardData,
  DashboardHolding,
  DashboardKpis,
  MarketSegment,
  SectorBar,
  TopMover,
} from "./types";

export type HoldingForDashboard = {
  instrumentId: string;
  ticker: string;
  instrumentName: string;
  instrumentType: InstrumentType;
  quantity: string;
  costBasisArs: string;
  marketValueArs: string;
  pnlArs: string;
  pnlPercent: string;
  /**
   * Costo en dólares al CCL del día de cada compra. `null` cuando no se pudo medir.
   *
   * Es el insumo que hace que el rendimiento en dólares diga algo: dividir el costo en
   * pesos por el CCL de hoy cancela el tipo de cambio y devuelve el mismo porcentaje
   * que en pesos.
   */
  costBasisUsd: string | null;
  /** Valor a mercado en dólares, al CCL de hoy. */
  marketValueUsd: string | null;
  pnlUsd: string | null;
  pnlPercentUsd: string | null;
  sector: string | null;
};

const SECTOR_ES: Record<string, string> = {
  Technology: "Tecnología",
  "Consumer Discretionary": "Consumo discrecional",
  "Consumer Staples": "Consumo básico",
  Financials: "Finanzas",
  Energy: "Energía",
  Utilities: "Servicios públicos",
  Materials: "Materiales",
  Industrials: "Industria",
  "Health Care": "Salud",
  Healthcare: "Salud",
  "Communication Services": "Comunicación",
  Communications: "Comunicación",
  "Real Estate": "Real Estate",
};

function translateSector(raw: string | null, instrumentType: InstrumentType): string {
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

function marketSegmentFor(type: InstrumentType): MarketSegment {
  switch (type) {
    case "CEDEAR":
      return "CEDEAR";
    case "STOCK_AR":
    case "BOND_AR":
    case "LETRA":
    case "ON":
    case "FCI":
      return "Locales";
    case "STOCK_US":
    case "ETF":
      return "Externos";
    case "CRYPTO":
    case "STABLECOIN":
      return "Cripto";
    default:
      return "Otros";
  }
}

function toFixed2(d: Decimal): string {
  return d.toFixed(2);
}

function pctOf(part: Decimal, total: Decimal): string {
  if (total.isZero()) return "0.00";
  return part.div(total).mul(100).toFixed(2);
}

function toUsd(amountArs: Decimal, cclRate: number | null): Decimal {
  if (!cclRate || cclRate <= 0) return new Decimal(0);
  return amountArs.div(cclRate);
}

type UsdFigures = {
  costBasis: Decimal;
  marketValue: Decimal;
  pnl: Decimal;
  pnlPercent: Decimal;
  /** El costo se estimó al CCL de hoy: el porcentaje no midió el tipo de cambio. */
  isApproximate: boolean;
};

/**
 * Las cifras en dólares de una posición.
 *
 * El valor a mercado va al CCL de hoy — es lo que vale hoy — y el costo al CCL del día
 * de cada compra. Esa asimetría es justamente lo que hace que el rendimiento en dólares
 * y el de pesos difieran: si el CCL subió más que el papel, ganaste en pesos y perdiste
 * en dólares, y esa es la información que se estaba perdiendo.
 *
 * Sin histórico de CCL para alguna compra se cae al CCL de hoy y se marca como
 * aproximado, en lugar de descartar la posición y desbalancear los totales.
 */
function usdFiguresFor(h: HoldingForDashboard, cclRate: number | null): UsdFigures {
  const marketValue =
    h.marketValueUsd !== null
      ? new Decimal(h.marketValueUsd)
      : toUsd(new Decimal(h.marketValueArs), cclRate);

  const isApproximate = h.costBasisUsd === null;
  const costBasis = isApproximate
    ? toUsd(new Decimal(h.costBasisArs), cclRate)
    : new Decimal(h.costBasisUsd!);

  const pnl = h.pnlUsd !== null ? new Decimal(h.pnlUsd) : marketValue.minus(costBasis);
  const pnlPercent =
    h.pnlPercentUsd !== null
      ? new Decimal(h.pnlPercentUsd)
      : costBasis.isZero()
        ? new Decimal(0)
        : pnl.div(costBasis).mul(100);

  return { costBasis, marketValue, pnl, pnlPercent, isApproximate };
}

export function buildDashboardData(args: {
  portfolioName: string;
  rawHoldings: HoldingForDashboard[];
  cclRate: number | null;
  cashArs?: string;
  cashUsd?: string;
  /** Serie histórica ya reconstruida. Se pasa entera: acá no se calcula nada. */
  evolution?: PortfolioEvolution;
}): DashboardData {
  const { portfolioName, rawHoldings, cclRate } = args;
  const cashArs = new Decimal(args.cashArs ?? "0");
  const cashUsd = new Decimal(args.cashUsd ?? "0");

  const usdByInstrument = new Map<string, UsdFigures>();
  let totalValue = new Decimal(0);
  let totalCost = new Decimal(0);
  let totalValueUsd = new Decimal(0);
  let totalCostUsd = new Decimal(0);
  let usdBasisIsApproximate = false;

  for (const h of rawHoldings) {
    totalValue = totalValue.plus(new Decimal(h.marketValueArs));
    totalCost = totalCost.plus(new Decimal(h.costBasisArs));

    const usd = usdFiguresFor(h, cclRate);
    usdByInstrument.set(h.instrumentId, usd);
    totalValueUsd = totalValueUsd.plus(usd.marketValue);
    totalCostUsd = totalCostUsd.plus(usd.costBasis);
    if (usd.isApproximate) usdBasisIsApproximate = true;
  }

  const pnl = totalValue.minus(totalCost);
  const pnlPct = totalCost.isZero() ? new Decimal(0) : pnl.div(totalCost).mul(100);
  const pnlUsd = totalValueUsd.minus(totalCostUsd);
  const pnlPctUsd = totalCostUsd.isZero() ? new Decimal(0) : pnlUsd.div(totalCostUsd).mul(100);

  const holdings: DashboardHolding[] = rawHoldings.map((h) => {
    const mv = new Decimal(h.marketValueArs);
    const usd = usdByInstrument.get(h.instrumentId)!;
    return {
      instrumentId: h.instrumentId,
      ticker: h.ticker,
      instrumentName: h.instrumentName,
      instrumentType: h.instrumentType,
      marketSegment: marketSegmentFor(h.instrumentType),
      sector: translateSector(h.sector, h.instrumentType),
      quantity: h.quantity,
      marketValueArs: mv.toFixed(2),
      marketValueUsd: usd.marketValue.toFixed(2),
      pnlArs: h.pnlArs,
      pnlPercent: h.pnlPercent,
      pnlUsd: usd.pnl.toFixed(2),
      pnlPercentUsd: usd.pnlPercent.toFixed(2),
      weightPercent: pctOf(mv, totalValue),
    };
  });

  holdings.sort((a, b) => Number(b.marketValueArs) - Number(a.marketValueArs));

  const equityHoldings = holdings.filter((h) => h.instrumentType !== "ON");
  const onHoldings = holdings.filter((h) => h.instrumentType === "ON");

  const allocationByTicker: AllocationSlice[] = equityHoldings.map((h) => ({
    key: h.instrumentId,
    label: h.ticker,
    valueArs: h.marketValueArs,
    valueUsd: h.marketValueUsd,
    percent: h.weightPercent,
  }));

  if (onHoldings.length > 0) {
    let onTotalArs = new Decimal(0);
    for (const h of onHoldings) {
      onTotalArs = onTotalArs.plus(h.marketValueArs);
    }
    allocationByTicker.push({
      key: "__on__",
      label: "ON",
      valueArs: onTotalArs.toFixed(2),
      valueUsd: toUsd(onTotalArs, cclRate).toFixed(2),
      percent: pctOf(onTotalArs, totalValue),
      details: onHoldings.map((h) => ({
        key: h.instrumentId,
        label: h.ticker,
        valueArs: h.marketValueArs,
        valueUsd: h.marketValueUsd,
        percent: h.weightPercent,
      })),
    });
  }

  allocationByTicker.sort((a, b) => Number(b.valueArs) - Number(a.valueArs));

  const marketMap = new Map<MarketSegment, Decimal>();
  for (const h of holdings) {
    const seg = h.marketSegment;
    marketMap.set(seg, (marketMap.get(seg) ?? new Decimal(0)).plus(h.marketValueArs));
  }
  const allocationByMarket: AllocationSlice[] = Array.from(marketMap.entries())
    .map(([seg, val]) => ({
      key: seg,
      label: seg,
      valueArs: val.toFixed(2),
      valueUsd: toUsd(val, cclRate).toFixed(2),
      percent: pctOf(val, totalValue),
    }))
    .sort((a, b) => Number(b.valueArs) - Number(a.valueArs));

  const sectorMap = new Map<string, Decimal>();
  for (const h of holdings) {
    sectorMap.set(h.sector, (sectorMap.get(h.sector) ?? new Decimal(0)).plus(h.marketValueArs));
  }
  const allocationBySector: SectorBar[] = Array.from(sectorMap.entries())
    .map(([sector, val]) => ({
      sector,
      valueArs: val.toFixed(2),
      valueUsd: toUsd(val, cclRate).toFixed(2),
      percent: pctOf(val, totalValue),
    }))
    .sort((a, b) => Number(b.valueArs) - Number(a.valueArs));

  const moversBase = holdings
    .filter((h) => Number(h.marketValueArs) > 0)
    .map<TopMover>((h) => ({
      ticker: h.ticker,
      instrumentName: h.instrumentName,
      pnlArs: h.pnlArs,
      pnlUsd: h.pnlUsd,
      pnlPercent: h.pnlPercent,
      pnlPercentUsd: h.pnlPercentUsd,
    }));

  /**
   * El ranking se arma por separado en cada moneda a propósito.
   *
   * No es el mismo orden reordenado: dos posiciones compradas a distinto CCL pueden
   * cambiar de puesto —y hasta de signo— al pasar a dólares. Rankear por el porcentaje
   * en pesos y mostrar el importe en dólares daría una lista que no es de nadie.
   */
  const rank = (pick: (m: TopMover) => number, direction: "gainers" | "losers") =>
    [...moversBase]
      .filter((m) => (direction === "gainers" ? pick(m) > 0 : pick(m) < 0))
      .sort((a, b) => (direction === "gainers" ? pick(b) - pick(a) : pick(a) - pick(b)))
      .slice(0, 5);

  const byArs = (m: TopMover) => Number(m.pnlPercent);
  const byUsd = (m: TopMover) => Number(m.pnlPercentUsd);

  const topGainers = rank(byArs, "gainers");
  const topLosers = rank(byArs, "losers");
  const topGainersUsd = rank(byUsd, "gainers");
  const topLosersUsd = rank(byUsd, "losers");

  const top5 = holdings.slice(0, 5);
  const top5Pct = top5.reduce((acc, h) => acc.plus(h.weightPercent), new Decimal(0));
  const topHolding = holdings[0] ?? null;
  let hhi = new Decimal(0);
  for (const h of holdings) {
    const w = new Decimal(h.weightPercent);
    hhi = hhi.plus(w.mul(w));
  }
  const hhiNum = Number(hhi.toFixed(0));
  let level: ConcentrationStats["level"];
  if (hhiNum < 1500) level = "baja";
  else if (hhiNum < 2500) level = "moderada";
  else if (hhiNum < 4000) level = "alta";
  else level = "muy_alta";

  const oversizedPositions = holdings
    .filter((h) => Number(h.weightPercent) > 25)
    .map((h) => ({ ticker: h.ticker, percent: h.weightPercent }));

  const concentration: ConcentrationStats = {
    top5Percent: top5Pct.toFixed(2),
    topHoldingTicker: topHolding?.ticker ?? null,
    topHoldingPercent: topHolding?.weightPercent ?? "0.00",
    hhi: hhi.toFixed(0),
    level,
    oversizedPositions,
  };

  const kpis: DashboardKpis = {
    totalInvestedArs: toFixed2(totalCost),
    totalInvestedUsd: toFixed2(totalCostUsd),
    currentValueArs: toFixed2(totalValue),
    currentValueUsd: toFixed2(totalValueUsd),
    unrealizedPnlArs: toFixed2(pnl),
    unrealizedPnlUsd: toFixed2(pnlUsd),
    unrealizedPnlPercent: pnlPct.toFixed(2),
    unrealizedPnlPercentUsd: pnlPctUsd.toFixed(2),
    usdBasisIsApproximate,
    cashArs: cashArs.toFixed(2),
    cashUsd: cashUsd.toFixed(2),
    totalInstruments: holdings.length,
  };

  return {
    hasData: holdings.length > 0,
    portfolioName,
    kpis,
    cclRate: cclRate ? cclRate.toFixed(2) : null,
    holdings,
    allocationByTicker,
    allocationByMarket,
    allocationBySector,
    topGainers,
    topLosers,
    topGainersUsd,
    topLosersUsd,
    concentration,
    evolution: args.evolution ?? EMPTY_EVOLUTION,
  };
}
