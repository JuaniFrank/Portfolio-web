/**
 * Detecta cuando el overlay "en vivo" de precios (`@/lib/rendimientos/live-overlay`) en
 * realidad repite el cierre real anterior de cada instrumento cotizado, en vez de traer
 * un precio intradiario nuevo.
 *
 * Pasa cuando el feed en vivo se consulta antes de la apertura (o el broker todavía no
 * actualizó su book): la cotización "de ahora" es, byte a byte, el cierre de ayer.
 * Agregar ese punto como "hoy" no suma información — es un día de mercado duplicado con
 * cambio exactamente cero en todos los instrumentos, no un cierre real. Este archivo
 * solo decide; quien arma el overlay (`evolution-data.ts`) decide qué hacer con el
 * resultado.
 *
 * Módulo puro: no sabe de fetch ni de Prisma.
 */

/** Cotización en vivo ya matcheada a un instrumento, misma forma que `LivePriceQuote`. */
export type LiveQuoteForEcho = { instrumentId: string; price: number | null };

const DEFAULT_EPSILON = 1e-9;

function isUsableQuote(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

/**
 * `true` cuando TODAS las cotizaciones en vivo utilizables (precio válido) igualan,
 * dentro de `epsilon` relativo, el cierre real inmediatamente anterior de su
 * instrumento (`lastCloseByInstrument`, `instrumentId → close`, ya resuelto por el
 * caller como el último precio EOD estrictamente anterior al día en vivo).
 *
 * Conservador en los dos bordes que importan: sin cotizaciones utilizables no hay
 * overlay que omitir (`false`: "no es echo" es el default seguro cuando la pregunta no
 * aplica), y un instrumento sin cierre previo con qué comparar tampoco cuenta como echo
 * — mejor agregar un overlay de más que perder un día real por clasificarlo mal.
 */
export function isEchoLiveSnapshot(
  liveQuotes: LiveQuoteForEcho[],
  lastCloseByInstrument: Map<string, number>,
  epsilon: number = DEFAULT_EPSILON
): boolean {
  const usableQuotes = liveQuotes.filter((quote) => isUsableQuote(quote.price));
  if (usableQuotes.length === 0) return false;

  for (const quote of usableQuotes) {
    const lastClose = lastCloseByInstrument.get(quote.instrumentId);
    if (lastClose === undefined) return false;

    const diff = Math.abs(quote.price! - lastClose);
    const relativeDiff = lastClose !== 0 ? diff / Math.abs(lastClose) : diff;
    if (relativeDiff > epsilon) return false;
  }

  return true;
}
