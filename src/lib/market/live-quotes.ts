/**
 * Puente impuro entre los lectores en vivo (data912, dolarapi) y el overlay puro de
 * `rendimientos/live-overlay.ts`.
 *
 * Nunca lanza: si algo falla, degrada al mismo comportamiento que había antes de esta
 * feature (overlay vacío → solo EOD persistido). El caller no necesita un try/catch propio.
 */

import type { InstrumentType } from "@/lib/generated/prisma";
import type { LivePriceQuote } from "@/lib/rendimientos/live-overlay";
import { fetchData912Live } from "./data912-universe";
import { fetchCclQuote } from "./dolarapi";

/** Revalidación corta: el overlay solo le importa el precio de ahora, no el histórico. */
const LIVE_OVERLAY_REVALIDATE_SECONDS = 60;

export type InstrumentForLiveOverlay = { id: string; ticker: string; type: InstrumentType };

export type LiveOverlayInputs = {
  priceQuotes: LivePriceQuote[];
  cclMid: number | null;
};

/**
 * Resuelve las cotizaciones en vivo de los instrumentos elegibles y el CCL de hoy.
 *
 * Match por ticker+type, igual que `market-snapshots.ts`: data912 no trae venue ni
 * moneda propios, así que no hay con qué cruzar más fino.
 */
export async function fetchLiveOverlayInputs(
  instruments: InstrumentForLiveOverlay[]
): Promise<LiveOverlayInputs> {
  if (instruments.length === 0) return { priceQuotes: [], cclMid: null };

  try {
    const [liveCatalog, cclQuote] = await Promise.all([
      fetchData912Live({ revalidateSeconds: LIVE_OVERLAY_REVALIDATE_SECONDS }),
      fetchCclQuote(),
    ]);

    const byTickerType = new Map(liveCatalog.map((item) => [`${item.ticker}|${item.type}`, item]));

    const priceQuotes: LivePriceQuote[] = [];
    for (const instrument of instruments) {
      const match = byTickerType.get(`${instrument.ticker}|${instrument.type}`);
      if (!match) continue;
      priceQuotes.push({ instrumentId: instrument.id, price: match.price });
    }

    return { priceQuotes, cclMid: cclQuote?.mid ?? null };
  } catch {
    return { priceQuotes: [], cclMid: null };
  }
}
