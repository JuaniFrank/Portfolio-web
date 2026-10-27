/**
 * Fuente de precios real de las alertas, con la misma base que "Ventas realizadas":
 * - USD (CEDEAR): cotización de Yahoo de la acción original (`fetchYahooQuote`); solo vale
 *   si viene en USD.
 * - ARS (acción local): último precio en vivo de data912 (el mismo que alimenta el overlay
 *   de la app), buscado por ticker y tipo `STOCK_AR`.
 * Un precio que no se pudo resolver no figura en el mapa: la alerta no dispara con datos
 * a medias. Nunca lanza.
 */

import { fetchData912Live } from "@/lib/market/data912-universe";
import { fetchYahooQuote } from "@/lib/market/yahoo";
import type { PriceSource } from "../ports";

const LIVE_REVALIDATE_SECONDS = 60;

export function createMarketPriceSource(): PriceSource {
  return {
    async resolve(requests) {
      const prices = new Map<string, number>();

      const usd = requests.filter((request) => request.currency === "USD");
      const ars = requests.filter((request) => request.currency === "ARS");

      const symbols = [...new Set(usd.map((request) => request.symbol))];
      const quotes = await Promise.allSettled(symbols.map((symbol) => fetchYahooQuote(symbol)));
      const priceBySymbol = new Map<string, number>();
      quotes.forEach((quote, index) => {
        const symbol = symbols[index];
        if (
          symbol &&
          quote.status === "fulfilled" &&
          quote.value.currency === "USD" &&
          quote.value.price > 0
        ) {
          priceBySymbol.set(symbol, quote.value.price);
        }
      });
      for (const request of usd) {
        const price = priceBySymbol.get(request.symbol);
        if (price !== undefined) prices.set(request.instrumentId, price);
      }

      if (ars.length > 0) {
        try {
          const live = await fetchData912Live({ revalidateSeconds: LIVE_REVALIDATE_SECONDS });
          const byTicker = new Map(
            live
              .filter((item) => item.type === "STOCK_AR" && item.price !== null && item.price > 0)
              .map((item) => [item.ticker, item.price as number])
          );
          for (const request of ars) {
            const price = byTicker.get(request.symbol);
            if (price !== undefined) prices.set(request.instrumentId, price);
          }
        } catch (error) {
          console.error("Price alerts: data912 live prices failed", error);
        }
      }

      return prices;
    },
  };
}
