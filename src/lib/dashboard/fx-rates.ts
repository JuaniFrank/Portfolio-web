/**
 * Vista serializable de MEP y CCL para el dashboard. **Módulo puro.**
 *
 * Todo viaja como string/null (como el resto de `DashboardData`) para cruzar sin
 * pérdida la frontera servidor→cliente: nada de `Date` ni `Decimal`.
 */

import type { FxDailyChange } from "@/lib/market/fx-daily-change";

export type FxRateView = {
  mid: string;
  previousMid: string | null;
  /** Fecha (YYYY-MM-DD, UTC) del cierre contra el que se compara. */
  previousDate: string | null;
  /** Diferencia en pesos por dólar contra el cierre previo. */
  changeArs: string | null;
  /** Variación porcentual contra el cierre previo. */
  changePct: string | null;
};

export type DashboardFxRates = { ccl: FxRateView | null; mep: FxRateView | null };

export const EMPTY_FX_RATES: DashboardFxRates = { ccl: null, mep: null };

const orNull = (value: number | null) => (value === null ? null : value.toFixed(2));

export function toFxRateView(change: FxDailyChange | null): FxRateView | null {
  if (!change) return null;
  return {
    mid: change.mid.toFixed(2),
    previousMid: orNull(change.previousMid),
    previousDate: change.previousDate ? change.previousDate.toISOString().slice(0, 10) : null,
    changeArs: orNull(change.changeArs),
    changePct: orNull(change.changePct),
  };
}
