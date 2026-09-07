import Decimal from "decimal.js";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import type { CorporateEventForBuilder } from "./types";

/**
 * Apply a sorted list of corporate events to a single trade.
 *
 * Rules (per spec FR-5, FR-10, FR-11):
 * - Events MUST be pre-sorted ascending by effectiveDate (caller responsibility).
 * - Pre-event condition: tradeDate < effectiveDate (lexical YYYY-MM-DD comparison).
 * - Post-event trades (tradeDate >= effectiveDate) are NOT adjusted.
 * - TICKER_CHANGE is a no-op — no quantity or price adjustment.
 * - netAmount is INVARIANT — only quantity and price are mutated.
 */
export function applyEventsToTrade(
  trade: TradeForHoldings,
  events: CorporateEventForBuilder[]
): TradeForHoldings {
  // tradeDate comes as ISO string; take the date prefix for lexical comparison
  const tradeDay = trade.tradeDate.slice(0, 10);

  let quantity = new Decimal(trade.quantity);
  let price = new Decimal(trade.price);

  for (const event of events) {
    // Only adjust pre-event trades
    if (tradeDay >= event.effectiveDate) continue;

    // TICKER_CHANGE is recorded but applies no math
    if (event.eventType === "TICKER_CHANGE") continue;

    const ratio = new Decimal(event.numerator).div(new Decimal(event.denominator));
    quantity = quantity.mul(ratio);
    price = price.div(ratio);
  }

  return {
    ...trade,
    quantity: quantity.toString(),
    price: price.toString(),
    // netAmount is intentionally unchanged
  };
}

/** Una rueda de la serie histórica de un instrumento. */
export type HistoricalBar = {
  date: Date;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

/**
 * Reescribe una serie histórica cruda a la escala **post-evento**, que es la única
 * en la que el motor de rendimientos puede usarla.
 *
 * Por qué hace falta: `applyEventsToTrade` normaliza las **cantidades** de los trades
 * previos a un evento multiplicándolas por el ratio. Para que `cantidad × precio` siga
 * dando el mismo valor, el precio de esos días tiene que venir dividido por el mismo
 * ratio. Yahoo ya entrega la serie reescrita retroactivamente; data912 entrega el
 * **nominal crudo de cada día**, así que su serie hay que ajustarla acá o las
 * posiciones quedan valuadas 3× o 10× de más antes de la fecha del evento.
 *
 * Misma regla, mismo sentido y misma comparación de fechas que `applyEventsToTrade`
 * (lexical `YYYY-MM-DD`, estrictamente anterior): si las dos divergen, el valor de la
 * cartera se rompe en silencio.
 *
 * El **volumen no se ajusta**: data912 lo publica como nocional en ARS, que es
 * invariante ante un split. Multiplicarlo inventaría volumen que no existió.
 */
export function adjustBarsForEvents(
  bars: HistoricalBar[],
  events: CorporateEventForBuilder[]
): HistoricalBar[] {
  if (events.length === 0) return bars;

  return bars.map((bar) => {
    const barDay = bar.date.toISOString().slice(0, 10);
    let factor = new Decimal(1);

    for (const event of events) {
      if (barDay >= event.effectiveDate) continue;
      if (event.eventType === "TICKER_CHANGE") continue;

      const denominator = new Decimal(event.denominator);
      // Un evento mal cargado no puede envenenar toda la serie con Infinity/NaN.
      if (denominator.isZero()) continue;
      const numerator = new Decimal(event.numerator);
      if (numerator.isZero()) continue;

      factor = factor.mul(numerator.div(denominator));
    }

    if (factor.equals(1)) return bar;

    const scale = (value: number | null) =>
      value === null ? null : new Decimal(value).div(factor).toNumber();

    return {
      ...bar,
      open: scale(bar.open),
      high: scale(bar.high),
      low: scale(bar.low),
      close: new Decimal(bar.close).div(factor).toNumber(),
    };
  });
}
