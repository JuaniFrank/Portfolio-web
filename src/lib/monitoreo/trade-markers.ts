import type { MonitoringBar, MonitoringCurrency, UiMonitoringSeriesKind } from "./types";

export type TradeSide = "BUY" | "SELL";

/**
 * Plain trade shape consumed by the marker logic — the server action serializes Prisma's
 * `Transaction` (Decimal/Date fields) into these before calling into this pure module.
 */
export type TradeMarkerInput = {
  id: string;
  /** YYYY-MM-DD */
  tradeDate: string;
  type: TradeSide;
  quantity: number;
  price: number;
  currencyCode: string;
  grossAmount: number;
  fees: number;
};

export type TradeMarkerSeriesContext = {
  kind: UiMonitoringSeriesKind;
  currency: MonitoringCurrency;
};

export type TradeMarkerTrade = {
  id: string;
  tradeDate: string;
  side: TradeSide;
  quantity: number;
  price: number;
  currencyCode: string;
  grossAmount: number;
  fees: number;
  /** null unless the comparability rule in `isComparable` holds for this trade */
  changeSinceTradePct: number | null;
};

export type TradeMarkerSide = "buy" | "sell" | "mixed";

export type TradeMarker = {
  /** Bar date (YYYY-MM-DD) this marker is snapped to — never the raw trade date */
  barTime: string;
  side: TradeMarkerSide;
  trades: TradeMarkerTrade[];
  totals: {
    totalBuyQuantity: number;
    totalSellQuantity: number;
    netQuantity: number;
    totalGrossAmount: number;
    totalFees: number;
  };
};

/**
 * Find the bar date a trade snaps to: the first bar on/after the trade date. Trades outside
 * the bar range (before the first bar or after the last bar) are dropped — there's no bar to
 * anchor the marker to, and markers only ever render on a visible bar.
 */
function snapToBarDate(tradeDate: string, bars: MonitoringBar[]): string | null {
  if (bars.length === 0) return null;
  const firstBar = bars[0]!;
  const lastBar = bars[bars.length - 1]!;
  if (tradeDate < firstBar.time || tradeDate > lastBar.time) return null;

  for (const b of bars) {
    if (b.time >= tradeDate) return b.time;
  }
  return null;
}

/**
 * "Change since trade" is only meaningful when the displayed series is the trade's own
 * native currency/instrument — a CEDEAR underlying or theoretical series is a different
 * price scale, and a corporate event after the trade date changes the share count/price
 * basis, so any comparison against it would be misleading.
 */
function isComparable(
  trade: TradeMarkerInput,
  seriesContext: TradeMarkerSeriesContext,
  corporateEventDates: string[]
): boolean {
  if (seriesContext.kind !== "native") return false;
  if (trade.currencyCode !== seriesContext.currency) return false;
  return !corporateEventDates.some((eventDate) => eventDate > trade.tradeDate);
}

/**
 * Group a user's BUY/SELL trades for one instrument into per-bar-date markers with
 * tooltip-ready metrics. Marker placement is always by bar date, never by trade price —
 * the displayed series may be in another scale/currency (CEDEAR underlying, USD,
 * unadjusted data912 bars) than the trade itself.
 */
export function buildTradeMarkers(
  trades: TradeMarkerInput[],
  bars: MonitoringBar[],
  seriesContext: TradeMarkerSeriesContext,
  corporateEventDates: string[] = []
): TradeMarker[] {
  if (trades.length === 0 || bars.length === 0) return [];

  const lastClose = bars[bars.length - 1]!.close;
  const grouped = new Map<string, TradeMarkerTrade[]>();

  for (const trade of trades) {
    const barTime = snapToBarDate(trade.tradeDate, bars);
    if (barTime === null) continue;

    const comparable = isComparable(trade, seriesContext, corporateEventDates);
    const changeSinceTradePct =
      comparable && trade.price > 0 ? ((lastClose - trade.price) / trade.price) * 100 : null;

    const entry: TradeMarkerTrade = {
      id: trade.id,
      tradeDate: trade.tradeDate,
      side: trade.type,
      quantity: trade.quantity,
      price: trade.price,
      currencyCode: trade.currencyCode,
      grossAmount: trade.grossAmount,
      fees: trade.fees,
      changeSinceTradePct,
    };

    const existing = grouped.get(barTime);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(barTime, [entry]);
    }
  }

  const markers: TradeMarker[] = [];
  for (const [barTime, groupTrades] of grouped) {
    const hasBuy = groupTrades.some((t) => t.side === "BUY");
    const hasSell = groupTrades.some((t) => t.side === "SELL");
    const side: TradeMarkerSide = hasBuy && hasSell ? "mixed" : hasBuy ? "buy" : "sell";

    let totalBuyQuantity = 0;
    let totalSellQuantity = 0;
    let totalGrossAmount = 0;
    let totalFees = 0;
    for (const t of groupTrades) {
      if (t.side === "BUY") {
        totalBuyQuantity += t.quantity;
      } else {
        totalSellQuantity += t.quantity;
      }
      totalGrossAmount += t.grossAmount;
      totalFees += t.fees;
    }

    markers.push({
      barTime,
      side,
      trades: groupTrades.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
      totals: {
        totalBuyQuantity,
        totalSellQuantity,
        netQuantity: totalBuyQuantity - totalSellQuantity,
        totalGrossAmount,
        totalFees,
      },
    });
  }

  return markers.sort((a, b) => a.barTime.localeCompare(b.barTime));
}
