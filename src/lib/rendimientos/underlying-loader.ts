/**
 * Orquestador (sin tests, como el resto de lo que toca la red/Prisma): baja de Yahoo la
 * historia y la cotización de la acción original de cada CEDEAR en cartera y arma los
 * números con los helpers puros de `underlying-price.ts`. Nunca tira: cualquier falla de
 * Yahoo deja ese dato en `null` y la tabla muestra "—".
 */

import { fetchYahooHistory, fetchYahooQuote } from "@/lib/market/yahoo";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import {
  formatExchangeName,
  underlyingAverageCost,
  type UnderlyingBar,
  type UnderlyingPrices,
} from "./underlying-price";

/** La historia se actualiza con las ruedas; medio día alcanza para una tabla. */
const HISTORY_REVALIDATE_SECONDS = 60 * 60 * 12;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Margen antes de la primera compra para poder tomar el cierre de la rueda anterior. */
const HISTORY_MARGIN_DAYS = 15;

export type UnderlyingCandidate = {
  instrumentId: string;
  /** Símbolo de Yahoo (`underlyingSymbolFor`). */
  symbol: string;
  trades: TradeForHoldings[];
  events: CorporateEventForBuilder[];
};

export type SymbolData = {
  bars: UnderlyingBar[] | null;
  price: number | null;
  exchange: string | null;
};

const startOfDay = (time: number) => Math.floor(time / MS_PER_DAY) * MS_PER_DAY;

/**
 * Historia y cotización de Yahoo por símbolo, para todos los candidatos (posiciones
 * abiertas y CEDEARs ya vendidos). Cada símbolo se baja una sola vez. Nunca tira: lo que
 * falla queda en `null` dentro de su `SymbolData`.
 */
export async function loadUnderlyingMarket(
  candidates: UnderlyingCandidate[],
  now: Date = new Date()
): Promise<Map<string, SymbolData>> {
  if (candidates.length === 0) return new Map();

  // Una variante (METAD) y su base (META) comparten símbolo: se baja una sola vez.
  const firstTradeBySymbol = new Map<string, number>();
  for (const candidate of candidates) {
    for (const trade of candidate.trades) {
      const time = new Date(trade.tradeDate).getTime();
      const current = firstTradeBySymbol.get(candidate.symbol);
      if (current === undefined || time < current) firstTradeBySymbol.set(candidate.symbol, time);
    }
    if (!firstTradeBySymbol.has(candidate.symbol)) firstTradeBySymbol.set(candidate.symbol, now.getTime());
  }

  // Fechas redondeadas a días enteros: la URL (period1/period2) es la clave de cache.
  const to = new Date(startOfDay(now.getTime()) + MS_PER_DAY);

  const entries = await Promise.all(
    [...firstTradeBySymbol].map(async ([symbol, firstTrade]) => {
      const from = new Date(startOfDay(firstTrade) - HISTORY_MARGIN_DAYS * MS_PER_DAY);
      const [history, quote] = await Promise.allSettled([
        fetchYahooHistory(symbol, { from, to }, { revalidateSeconds: HISTORY_REVALIDATE_SECONDS }),
        fetchYahooQuote(symbol),
      ]);

      // Solo USD: una cotización en otra moneda no es comparable con el costo en dólares.
      const historyOk = history.status === "fulfilled" && history.value.currency === "USD";
      const quoteOk = quote.status === "fulfilled" && quote.value.currency === "USD";

      const data: SymbolData = {
        bars: historyOk
          ? history.value.bars.map((bar) => ({ date: bar.date, close: bar.close }))
          : null,
        price: quoteOk ? quote.value.price : null,
        exchange: quote.status === "fulfilled" ? formatExchangeName(quote.value.exchange) : null,
      };
      return [symbol, data] as const;
    })
  );
  return new Map(entries);
}

export async function loadUnderlyingPrices(
  candidates: UnderlyingCandidate[],
  now: Date = new Date(),
  /** Datos ya bajados con `loadUnderlyingMarket`; si no se pasan, se bajan acá. */
  market?: Map<string, SymbolData>
): Promise<Map<string, UnderlyingPrices>> {
  const result = new Map<string, UnderlyingPrices>();
  if (candidates.length === 0) return result;

  const bySymbol = market ?? (await loadUnderlyingMarket(candidates, now));

  for (const candidate of candidates) {
    const data = bySymbol.get(candidate.symbol);
    if (!data) continue;
    result.set(candidate.instrumentId, {
      symbol: candidate.symbol,
      exchange: data.exchange,
      avgCostUsd: data.bars
        ? underlyingAverageCost(candidate.trades, candidate.events, data.bars)
        : null,
      priceUsd: data.price,
    });
  }

  return result;
}
