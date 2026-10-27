/**
 * Acción original de cada venta realizada: a cuánto compraste el papel de fondo, a cuánto
 * valía el día que vendiste y a cuánto vale hoy. Sirve para detectar una re-entrada: un
 * papel que vendiste y que hoy está más barato que en tu venta.
 *
 * La base de comparación no es la del instrumento negociado:
 * - CEDEAR → la acción en su mercado de origen, en USD. Comparar contra el precio en
 *   pesos del CEDEAR mezclaría CCL, ratio y splits.
 * - Acción local → el mismo papel, en ARS, **en unidades de hoy** (ajustado por splits).
 * - Cualquier otro tipo → sin bloque (`null`).
 *
 * **Módulo puro**: sin Prisma ni red. Las ruedas y cotizaciones llegan ya cargadas y las
 * ruedas tienen que venir en la escala post-evento (Yahoo ya lo hace; las de data912 se
 * guardan ajustadas con `adjustBarsForEvents`). Ver `realized-original.test.ts`.
 */

import Decimal from "decimal.js";
import { applyEventsToTrade } from "@/lib/events/apply";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import type { RealizedSale } from "./realized-sales";
import {
  closeOnOrBefore,
  underlyingAverageCost,
  type UnderlyingBar,
} from "./underlying-price";

export type OriginalBasis = "USD" | "ARS";

/** Cifras de la acción original de una venta. Cada número es `null` si no se pudo medir. */
export type RealizedOriginal = {
  basis: OriginalBasis;
  /** Símbolo de la acción original (p. ej. AAPL, o el ticker local). */
  symbol: string;
  /** Mercado de origen, si se conoce. */
  exchange: string | null;
  /** Promedio de compra de la posición al momento de la venta. */
  avgCost: number | null;
  /** Cierre del día de la venta (o de la rueda anterior). */
  saleDayPrice: number | null;
  currentPrice: number | null;
  /** `(actual / venta − 1) × 100`. */
  pctVsSale: number | null;
  /** El precio actual quedó por debajo del de la venta: señal de re-entrada. */
  belowSale: boolean;
};

/** Lo que el loader resuelve por instrumento. `bars` es `null` si no se pudo bajar. */
export type OriginalSource = {
  basis: OriginalBasis;
  symbol: string;
  exchange: string | null;
  bars: UnderlyingBar[] | null;
  currentPrice: number | null;
};

const QUANTITY_EPSILON = new Decimal("0.0000001");

/**
 * Devuelve las mismas ventas con su bloque `original`. Mantiene el orden y la cantidad.
 *
 * @param trades los mismos trades con los que se armaron las ventas.
 * @param events eventos corporativos por instrumento, ascendentes por fecha efectiva.
 * @param sources fuente por `instrumentId`; sin entrada, la venta queda con `original: null`.
 */
export function withRealizedOriginals(
  sales: RealizedSale[],
  trades: TradeForHoldings[],
  events: Map<string, CorporateEventForBuilder[]>,
  sources: Map<string, OriginalSource>
): RealizedSale[] {
  const tradesByInstrument = new Map<string, TradeForHoldings[]>();
  for (const trade of trades) {
    const list = tradesByInstrument.get(trade.instrumentId) ?? [];
    list.push(trade);
    tradesByInstrument.set(trade.instrumentId, list);
  }

  // Para cada instrumento, los trades previos a cada venta, en el orden en que
  // `buildRealizedSales` las emite (una por SELL con posición previa).
  const priorBySale = new Map<RealizedSale, TradeForHoldings[]>();
  const salesByInstrument = new Map<string, RealizedSale[]>();
  for (const sale of sales) {
    const list = salesByInstrument.get(sale.instrumentId) ?? [];
    list.push(sale);
    salesByInstrument.set(sale.instrumentId, list);
  }

  for (const [instrumentId, instrumentSales] of salesByInstrument) {
    const sorted = [...(tradesByInstrument.get(instrumentId) ?? [])].sort(
      (a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime()
    );
    const instrumentEvents = events.get(instrumentId) ?? [];
    const adjusted = instrumentEvents.length
      ? sorted.map((trade) => applyEventsToTrade(trade, instrumentEvents))
      : sorted;

    let running = new Decimal(0);
    let next = 0;
    adjusted.forEach((trade, index) => {
      const quantity = new Decimal(trade.quantity);
      if (trade.type === "BUY") {
        running = running.plus(quantity);
        return;
      }
      if (running.gt(QUANTITY_EPSILON)) {
        const sale = instrumentSales[next];
        // Si no coincide la fecha, el emparejamiento no es confiable: sin cifras.
        if (sale && sale.tradeDate === trade.tradeDate) {
          priorBySale.set(sale, sorted.slice(0, index));
        }
        next += 1;
      }
      running = Decimal.max(running.minus(quantity), 0);
    });
  }

  return sales.map((sale) => {
    const source = sources.get(sale.instrumentId);
    const prior = priorBySale.get(sale);
    if (!source) return { ...sale, original: null };
    return {
      ...sale,
      original: buildOriginal(
        sale,
        prior ?? null,
        events.get(sale.instrumentId) ?? [],
        source
      ),
    };
  });
}

function buildOriginal(
  sale: RealizedSale,
  prior: TradeForHoldings[] | null,
  events: CorporateEventForBuilder[],
  source: OriginalSource
): RealizedOriginal {
  const saleDay = new Date(`${sale.tradeDate.slice(0, 10)}T00:00:00.000Z`);
  const bars = source.bars;

  const avgCost = bars && prior ? underlyingAverageCost(prior, events, bars) : null;
  const saleDayPrice = bars && !Number.isNaN(saleDay.getTime()) ? closeOnOrBefore(bars, saleDay) : null;
  const currentPrice = source.currentPrice;

  const comparable = saleDayPrice !== null && saleDayPrice > 0 && currentPrice !== null;

  return {
    basis: source.basis,
    symbol: source.symbol,
    exchange: source.exchange,
    avgCost,
    saleDayPrice,
    currentPrice,
    pctVsSale: comparable ? (currentPrice / saleDayPrice - 1) * 100 : null,
    belowSale: comparable && currentPrice < saleDayPrice,
  };
}
