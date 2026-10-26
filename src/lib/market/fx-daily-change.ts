/**
 * Variación diaria de un tipo de cambio (MEP o CCL). **Módulo puro.**
 *
 * Responde "¿cuánto se movió el dólar desde el último cierre?": el valor de hoy contra el
 * último dato guardado de una fecha anterior. Los fines de semana la fuente arrastra el
 * cierre del viernes, así que sábado y domingo dan ~0%, que es lo correcto.
 */

export type FxPreviousClose = { date: Date; mid: number };

export type FxDailyChange = {
  mid: number;
  previousMid: number | null;
  previousDate: Date | null;
  /** Diferencia en pesos por dólar; `null` si no hay cierre previo utilizable. */
  changeArs: number | null;
  /** Variación porcentual (1.79 = +1.79%); `null` si no hay cierre previo utilizable. */
  changePct: number | null;
};

export function computeFxDailyChange(
  currentMid: number,
  previous: FxPreviousClose | null
): FxDailyChange {
  if (!previous || !Number.isFinite(previous.mid) || previous.mid <= 0) {
    return { mid: currentMid, previousMid: null, previousDate: null, changeArs: null, changePct: null };
  }

  const changeArs = currentMid - previous.mid;
  return {
    mid: currentMid,
    previousMid: previous.mid,
    previousDate: previous.date,
    changeArs,
    changePct: (changeArs / previous.mid) * 100,
  };
}
