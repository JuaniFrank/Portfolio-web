"use server";

import { getCurrentUser } from "@/lib/auth";
import {
  toDashboardHolding,
  toBondTrade,
  valuateOnPositions,
} from "@/lib/bonds/portfolio-bridge";
import {
  buildDashboardData,
  type HoldingForDashboard,
} from "@/lib/dashboard/build";
import { loadPortfolioEvolution } from "@/lib/dashboard/evolution-data";
import { EMPTY_EVOLUTION, type PortfolioEvolution } from "@/lib/dashboard/evolution";
import type { DashboardData } from "@/lib/dashboard/types";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import { fetchOnPrices } from "@/lib/market/data912";
import { resolveCclRate } from "@/lib/market/ccl-rate";
import { cclLookupFrom, loadCclSeries } from "@/lib/market/ccl-history";
import { refreshLatestQuotes, type InstrumentForQuote } from "@/lib/market/quotes";
import { prisma } from "@/lib/prisma";
import { resolveRawSector } from "@/lib/sector";
import {
  buildHoldings,
  type TradeForHoldings,
} from "@/lib/transactions/holdings";
import {
  FIXED_INCOME_TYPES,
  TRADE_INSTRUMENT_TYPES,
  TRADE_TYPES,
} from "@/lib/transactions/types";

/**
 * La serie histórica es la parte lenta del loader y solo la consumen el gráfico, los KPIs
 * de período y los movimientos del día. Va aparte, como promesa sin esperar, para que la
 * página pinte el resto (KPIs, composición, tablas) mientras la serie se sigue calculando.
 * `data` es exactamente lo que antes devolvía el loader, menos `evolution`.
 */
export type DashboardPageData = {
  data: Omit<DashboardData, "evolution">;
  evolution: Promise<PortfolioEvolution>;
};

export async function getDashboardPageDataAction(): Promise<
  DashboardPageData | { error: "unauthorized" }
> {
  const user = await getCurrentUser();
  if (!user) return { error: "unauthorized" };

  const portfolio = await prisma.portfolio.findFirst({
    where: { userId: user.id, archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });

  if (!portfolio) {
    return {
      data: withoutEvolution(
        buildDashboardData({ portfolioName: "Sin portfolio", rawHoldings: [], cclRate: null })
      ),
      evolution: Promise.resolve(EMPTY_EVOLUTION),
    };
  }

  // La serie de CCL se comparte entre la valuación de posiciones y la serie histórica
  // para no leer dos veces la misma tabla. La serie arranca apenas hay CCL y corre en
  // paralelo con el resto del loader; nadie la espera acá.
  const cclSeriesPromise = loadCclSeries();
  const evolution = cclSeriesPromise.then((series) =>
    loadPortfolioEvolution([portfolio.id], series)
  );
  // Si el loader principal falla antes de consumirla, que no quede un rechazo sin
  // manejar; quien sí la consuma (`use`) igual recibe el error.
  evolution.catch(() => undefined);

  const [rows, cclRate, cclSeries, eventRows] = await Promise.all([
    prisma.transaction.findMany({
      where: {
        portfolioId: portfolio.id,
        type: { in: TRADE_TYPES },
        instrument: { type: { in: TRADE_INSTRUMENT_TYPES } },
        instrumentId: { not: null },
      },
      orderBy: { tradeDate: "asc" },
      include: {
        instrument: {
          select: {
            id: true,
            ticker: true,
            name: true,
            type: true,
            currencyCode: true,
            settlement: true,
            sector: true,
            baseInstrument: { select: { ticker: true, sector: true } },
            underlyingAsset: { select: { sector: true } },
          },
        },
      },
    }),
    resolveCclRate(),
    cclSeriesPromise,
    prisma.corporateEvent.findMany({
      where: {
        instrument: {
          transactions: { some: { portfolioId: portfolio.id } },
        },
      },
      orderBy: { effectiveDate: "asc" },
      select: {
        instrumentId: true,
        eventType: true,
        effectiveDate: true,
        numerator: true,
        denominator: true,
      },
    }),
  ]);

  // Build events map: instrumentId → events sorted ascending by effectiveDate
  const eventsMap = new Map<string, CorporateEventForBuilder[]>();
  for (const e of eventRows) {
    const list = eventsMap.get(e.instrumentId) ?? [];
    list.push({
      instrumentId: e.instrumentId,
      eventType: e.eventType,
      effectiveDate: e.effectiveDate.toISOString().slice(0, 10),
      numerator: e.numerator.toString(),
      denominator: e.denominator.toString(),
    });
    eventsMap.set(e.instrumentId, list);
  }

  const trades: TradeForHoldings[] = [];
  const onBondTrades: ReturnType<typeof toBondTrade>[] = [];
  const sectorByInstrument = new Map<string, string | null>();
  const onNamesById = new Map<string, string>();
  const uniqueInstruments = new Map<string, InstrumentForQuote>();

  for (const r of rows) {
    if (!r.instrument) continue;
    const trade: TradeForHoldings = {
      instrumentId: r.instrument.id,
      ticker: r.instrument.ticker,
      instrumentType: r.instrument.type,
      instrumentName: r.instrument.name,
      type: r.type as "BUY" | "SELL",
      quantity: r.quantity.toString(),
      price: r.price.toString(),
      netAmount: r.netAmount.toString(),
      tradeDate: r.tradeDate.toISOString(),
    };

    // AD-3 3-step sector fallback (design §2.3, `@/lib/sector`). Applied on
    // BOTH branches — the fixed-income branch used to `continue` before this
    // line and therefore never recorded a sector for a bond/ON at all.
    const sector = resolveRawSector({
      instrumentSector: r.instrument.sector,
      baseInstrumentSector: r.instrument.baseInstrument?.sector,
      underlyingAssetSector: r.instrument.underlyingAsset?.sector,
    });
    sectorByInstrument.set(r.instrument.id, sector);

    if (FIXED_INCOME_TYPES.includes(r.instrument.type)) {
      onBondTrades.push(toBondTrade(trade, r.currencyCode));
      onNamesById.set(r.instrument.id, r.instrument.name);
      continue;
    }

    trades.push(trade);
    if (!uniqueInstruments.has(r.instrument.id)) {
      uniqueInstruments.set(r.instrument.id, {
        id: r.instrument.id,
        ticker: r.instrument.ticker,
        type: r.instrument.type,
        currencyCode: r.instrument.currencyCode,
        settlement: r.instrument.settlement,
        baseInstrument: r.instrument.baseInstrument,
      });
    }
  }

  const onTickers = Array.from(new Set(onBondTrades.map((t) => t.ticker.toUpperCase())));

  const [{ prices }, onPriceResult] = await Promise.all([
    refreshLatestQuotes([...uniqueInstruments.values()]),
    onTickers.length > 0 ? fetchOnPrices(onTickers) : Promise.resolve({ quotes: new Map(), stale: false }),
  ]);

  // El costo de cada posición se replaya contra el CCL del día de cada compra; el valor
  // a mercado va al CCL de hoy. Esa asimetría es lo que hace que el rendimiento en
  // dólares mida algo distinto del de pesos.
  const cclAt = cclLookupFrom(cclSeries);

  const equityHoldings = buildHoldings(trades, prices, eventsMap, {
    cclAt,
    currentCcl: cclRate,
  });
  const onPositions = valuateOnPositions(onBondTrades, onPriceResult, cclRate, onNamesById, {
    cclAt,
  });

  const rawHoldings: HoldingForDashboard[] = [
    ...equityHoldings.map((h) => ({
      instrumentId: h.instrumentId,
      ticker: h.ticker,
      instrumentName: h.instrumentName,
      instrumentType: h.instrumentType,
      quantity: h.quantity,
      costBasisArs: h.costBasisArs,
      marketValueArs: h.marketValueArs,
      pnlArs: h.pnlArs,
      pnlPercent: h.pnlPercent,
      costBasisUsd: h.costBasisUsd,
      marketValueUsd: h.marketValueUsd,
      pnlUsd: h.pnlUsd,
      pnlPercentUsd: h.pnlPercentUsd,
      sector: sectorByInstrument.get(h.instrumentId) ?? null,
    })),
    ...onPositions.map((p) => toDashboardHolding(p, sectorByInstrument.get(p.instrumentId) ?? null)),
  ];

  return {
    data: withoutEvolution(
      buildDashboardData({ portfolioName: portfolio.name, rawHoldings, cclRate })
    ),
    evolution,
  };
}

/** `buildDashboardData` rellena `evolution` con la serie vacía; acá se descarta porque la
 * real viaja aparte. */
function withoutEvolution(data: DashboardData): Omit<DashboardData, "evolution"> {
  const { evolution: _placeholder, ...rest } = data;
  void _placeholder;
  return rest;
}
