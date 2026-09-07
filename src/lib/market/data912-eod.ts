/**
 * Adaptador de la serie histórica de data912 al formato EOD que persiste `PriceCache`.
 *
 * Reusa `fetchData912History` (el mismo fetcher que consume `/monitoreo`, con su caché
 * de 1 h y su manejo de 404/429) y solo traduce la forma: `MonitoringBar.time` es un
 * `"YYYY-MM-DD"` para los charts, mientras que el motor de rendimientos trabaja con
 * `Date` a medianoche UTC (ver `months.ts`).
 *
 * ⚠️ **Los precios de data912 vienen SIN ajustar por eventos corporativos.** Yahoo
 * reescribe su serie retroactivamente ante un split; data912 publica el nominal crudo
 * de cada día. Medido contra nuestra serie: SPY (ratio 3:1 del 29/05/2026) sale 3× más
 * alto y YPFD (split 10:1 del 03/08/2026) 10× más alto en todo el tramo previo.
 * Quien persista estas barras **tiene** que pasarlas por `adjustBarsForEvents` primero,
 * porque `buildHoldings` ya trabaja con cantidades normalizadas a la escala post-evento.
 */

import type { InstrumentType } from "@/lib/generated/prisma";
import type { HistoricalBar } from "@/lib/events/apply";
import type { MonitoringBar } from "@/lib/monitoreo/types";
import { fetchData912History } from "./data912-history";

/**
 * Traduce las barras de `/monitoreo` al formato del motor de rendimientos.
 *
 * Puro y exportado aparte para poder testearlo sin red — la regla del proyecto es que
 * la lógica riesgosa viva en módulos puros (ver `vitest.config.mts`).
 *
 * Descarta ruedas sin cierre positivo: un `0` en el cierre no significa "valió cero",
 * es un día sin dato, y propagarlo produciría un −100 % que envenena todo el acumulado.
 */
export function toHistoricalBars(bars: MonitoringBar[]): HistoricalBar[] {
  const byDay = new Map<number, HistoricalBar>();

  for (const bar of bars) {
    if (typeof bar?.time !== "string") continue;
    if (!Number.isFinite(bar.close) || bar.close <= 0) continue;

    const date = new Date(`${bar.time.slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) continue;

    byDay.set(date.getTime(), {
      date,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
    });
  }

  return [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export type Data912EodResult = {
  bars: HistoricalBar[];
  /** `null` si salió bien. Nunca tira: es una fuente de respaldo. */
  error: string | null;
};

/**
 * Serie EOD completa de un ticker. **No filtra por rango**: el endpoint devuelve todo
 * el histórico y recortarlo es responsabilidad del llamador.
 *
 * Un respaldo que rompe el backfill entero es peor que no tener respaldo, así que
 * cualquier fallo vuelve como `error` con la lista de barras vacía.
 */
export async function fetchData912Eod(
  ticker: string,
  type: InstrumentType
): Promise<Data912EodResult> {
  // Solo estos dos tipos tienen endpoint; el resto ni se pide.
  if (type !== "CEDEAR" && type !== "STOCK_AR") {
    return { bars: [], error: `tipo ${type} sin endpoint histórico en data912` };
  }

  const { bars, error } = await fetchData912History(ticker, type);
  if (error) return { bars: [], error };

  const converted = toHistoricalBars(bars);
  // 200 con lista vacía = ticker fuera de su catálogo (verificado: PEP, PM, TSM).
  if (converted.length === 0) {
    return { bars: [], error: `data912 ${ticker.toUpperCase()}: sin datos` };
  }

  return { bars: converted, error: null };
}
