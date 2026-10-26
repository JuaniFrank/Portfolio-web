/**
 * Precio de la acción original (la del mercado de origen) detrás de un CEDEAR.
 * **Módulo puro**: no toca Prisma ni la red — el loader le pasa las ruedas de Yahoo ya
 * bajadas. Se usa Yahoo y no `Instrument.conversionRatio` porque ese dato es nulo o un
 * placeholder erróneo en la mayoría de los CEDEARs.
 */

import Decimal from "decimal.js";
import { applyEventsToTrade } from "@/lib/events/apply";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import type { InstrumentType } from "@/lib/generated/prisma";
import type { TradeForHoldings } from "@/lib/transactions/holdings";

export type UnderlyingSymbolInput = {
  type: InstrumentType;
  ticker: string;
  /** Ticker canónico del `UnderlyingAsset` del instrumento, si lo tiene. */
  underlyingAssetTicker?: string | null;
  /** Instrumento base de una variante de liquidación (p. ej. METAD → META). */
  baseInstrument?: { ticker: string; underlyingAssetTicker?: string | null } | null;
};

/**
 * Símbolo de Yahoo del subyacente en su mercado de origen (sin sufijo `.BA`), o `null`
 * si el instrumento no es un CEDEAR. Orden de preferencia: subyacente propio, subyacente
 * del base, ticker del base, ticker propio. Yahoo escribe las clases con guion
 * (`BRK.B` → `BRK-B`).
 */
export function underlyingSymbolFor(input: UnderlyingSymbolInput): string | null {
  if (input.type !== "CEDEAR") return null;

  const raw =
    input.underlyingAssetTicker ||
    input.baseInstrument?.underlyingAssetTicker ||
    input.baseInstrument?.ticker ||
    input.ticker;

  const symbol = raw.trim().toUpperCase().replaceAll(".", "-");
  return symbol === "" ? null : symbol;
}

/** Una rueda del subyacente: cierre **split-ajustado** de Yahoo (no `adjclose`). */
export type UnderlyingBar = { date: Date; close: number };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** Más atrás que esto no es "la rueda anterior" sino un hueco de datos: mejor `null`
 * que presentar un cierre viejo como el de la fecha de compra. Cubre fines de semana
 * largos y feriados encadenados de EE.UU. */
const MAX_LOOKBACK_DAYS = 10;
/** Mismo umbral que `position-rows.ts` para considerar "cerrada" una cantidad. */
const QUANTITY_EPSILON = new Decimal("0.0000001");

/**
 * Cierre de la última rueda con fecha igual o anterior a `day`. `bars` va ordenado
 * ascendente. Una compra de sábado o de un feriado de EE.UU. toma el cierre de la rueda
 * anterior. `null` si no hay ninguna dentro de la ventana de búsqueda.
 */
export function closeOnOrBefore(bars: UnderlyingBar[], day: Date): number | null {
  const target = day.getTime();
  let low = 0;
  let high = bars.length - 1;
  let found = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (bars[mid]!.date.getTime() <= target) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (found === -1) return null;
  const bar = bars[found]!;
  return target - bar.date.getTime() > MAX_LOOKBACK_DAYS * MS_PER_DAY ? null : bar.close;
}

/**
 * Costo promedio en USD de la acción original sobre el lote abierto: el cierre del
 * subyacente en cada día de compra, ponderado por la cantidad **ajustada por eventos
 * corporativos** (igual que `buildHoldings`, para que un cambio de ratio no desbalancee
 * los lotes viejos). Mismo método de costo promedio que el del CEDEAR: una venta parcial
 * conserva el promedio y una venta total reinicia el lote.
 *
 * `null` sin posición abierta o si alguna compra del lote abierto no tiene cierre: un
 * promedio a medias es peor que no mostrarlo.
 */
export function underlyingAverageCost(
  trades: TradeForHoldings[],
  events: CorporateEventForBuilder[],
  bars: UnderlyingBar[]
): number | null {
  const sorted = trades
    .map((trade) => (events.length > 0 ? applyEventsToTrade(trade, events) : trade))
    .sort((a, b) => new Date(a.tradeDate).getTime() - new Date(b.tradeDate).getTime());

  let quantity = new Decimal(0);
  let cost = new Decimal(0);
  let measurable = true;

  for (const trade of sorted) {
    const tradeQuantity = new Decimal(trade.quantity);

    if (trade.type === "BUY") {
      const day = new Date(`${trade.tradeDate.slice(0, 10)}T00:00:00.000Z`);
      const close = closeOnOrBefore(bars, day);
      if (close === null) measurable = false;
      else cost = cost.plus(tradeQuantity.mul(close));
      quantity = quantity.plus(tradeQuantity);
      continue;
    }

    if (!quantity.isZero()) cost = cost.minus(cost.mul(tradeQuantity.div(quantity)));
    quantity = quantity.minus(tradeQuantity);
    if (quantity.lte(QUANTITY_EPSILON)) {
      // Venta total: el próximo lote arranca de cero, con su propia medibilidad.
      quantity = new Decimal(0);
      cost = new Decimal(0);
      measurable = true;
    }
  }

  if (quantity.lte(QUANTITY_EPSILON) || !measurable) return null;
  return cost.div(quantity).toNumber();
}

/**
 * Nombre corto del mercado a partir del `fullExchangeName` de Yahoo ("NasdaqGS" →
 * "NASDAQ", "NYSEArca" → "NYSE Arca"). Lo desconocido se muestra tal cual.
 */
export function formatExchangeName(fullExchangeName: string | null | undefined): string | null {
  const name = fullExchangeName?.trim();
  if (!name) return null;
  if (/^nasdaq/i.test(name)) return "NASDAQ";
  if (/^nyse\s*arca$/i.test(name)) return "NYSE Arca";
  if (/^nyse\s*american$/i.test(name)) return "NYSE American";
  return name;
}

/** Lo que el loader resuelve por posición. Cada número es `null` si no se pudo medir. */
export type UnderlyingPrices = {
  symbol: string;
  exchange: string | null;
  avgCostUsd: number | null;
  priceUsd: number | null;
};
