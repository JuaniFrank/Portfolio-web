import Decimal from "decimal.js";
import type { InstrumentType } from "@/lib/generated/prisma";
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

export function buildDashboardData(args: {
  portfolioName: string;
  rawHoldings: HoldingForDashboard[];
  cclRate: number | null;
  cashArs?: string;
  cashUsd?: string;
}): DashboardData {
  const { portfolioName, rawHoldings, cclRate } = args;
  const cashArs = new Decimal(args.cashArs ?? "0");
  const cashUsd = new Decimal(args.cashUsd ?? "0");

  let totalValue = new Decimal(0);
  let totalCost = new Decimal(0);
  for (const h of rawHoldings) {
    totalValue = totalValue.plus(new Decimal(h.marketValueArs));
    totalCost = totalCost.plus(new Decimal(h.costBasisArs));
  }
  const pnl = totalValue.minus(totalCost);
  const pnlPct = totalCost.isZero() ? new Decimal(0) : pnl.div(totalCost).mul(100);

  const holdings: DashboardHolding[] = rawHoldings.map((h) => {
    const mv = new Decimal(h.marketValueArs);
    return {
      instrumentId: h.instrumentId,
      ticker: h.ticker,
      instrumentName: h.instrumentName,
      instrumentType: h.instrumentType,
      marketSegment: marketSegmentFor(h.instrumentType),
      sector: translateSector(h.sector, h.instrumentType),
      quantity: h.quantity,
      marketValueArs: mv.toFixed(2),
      marketValueUsd: toUsd(mv, cclRate).toFixed(2),
      pnlArs: h.pnlArs,
      pnlPercent: h.pnlPercent,
      weightPercent: pctOf(mv, totalValue),
    };
  });

  holdings.sort((a, b) => Number(b.marketValueArs) - Number(a.marketValueArs));

  const allocationByTicker: AllocationSlice[] = holdings.map((h) => ({
    key: h.instrumentId,
    label: h.ticker,
    valueArs: h.marketValueArs,
    valueUsd: h.marketValueUsd,
    percent: h.weightPercent,
  }));

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
      pnlUsd: toUsd(new Decimal(h.pnlArs), cclRate).toFixed(2),
      pnlPercent: h.pnlPercent,
    }));

  const topGainers = [...moversBase]
    .filter((m) => Number(m.pnlPercent) > 0)
    .sort((a, b) => Number(b.pnlPercent) - Number(a.pnlPercent))
    .slice(0, 5);

  const topLosers = [...moversBase]
    .filter((m) => Number(m.pnlPercent) < 0)
    .sort((a, b) => Number(a.pnlPercent) - Number(b.pnlPercent))
    .slice(0, 5);

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
    totalInvestedUsd: toUsd(totalCost, cclRate).toFixed(2),
    currentValueArs: toFixed2(totalValue),
    currentValueUsd: toUsd(totalValue, cclRate).toFixed(2),
    unrealizedPnlArs: toFixed2(pnl),
    unrealizedPnlUsd: toUsd(pnl, cclRate).toFixed(2),
    unrealizedPnlPercent: pnlPct.toFixed(2),
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
    concentration,
  };
}
