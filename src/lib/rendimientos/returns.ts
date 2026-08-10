/**
 * Matemática de rendimientos. **Módulo puro**: no toca DB, ni red, ni fechas del
 * sistema. Todo entra por parámetro y sale por retorno, así que es el único lugar
 * del motor que se puede testear a fondo con fixtures — y es el que más lo necesita,
 * porque acá se decide si los números que ve el usuario son correctos.
 *
 * Convenciones que atraviesan todo el archivo:
 *   - Los porcentajes se devuelven **en puntos porcentuales** (5 = 5 %), igual que
 *     el resto del proyecto.
 *   - `null` significa "no hay base comparable", NUNCA cero. Un cero se lee como
 *     "no pasó nada", que es una afirmación distinta a "no lo puedo medir".
 */

/**
 * Pérdida total: una cartera long-only no puede rendir menos de −100 %.
 *
 * No es una preferencia estética. Un rendimiento por debajo de −100 % vuelve negativo
 * el factor `1 + R/100`, y a partir de ahí el encadenamiento **invierte el signo** de
 * todos los meses siguientes: un mes con +5 % pasaría a bajar el acumulado. Un solo
 * valor fuera de rango envenena toda la serie.
 */
const MIN_RETURN_PERCENT = -100;

/**
 * Rendimiento de un subperíodo entre dos valuaciones consecutivas.
 *
 * ```
 *        V_fin − V_ini − F
 * r  =  ───────────────────
 *              base
 *
 *   base = V_ini   si había cartera al empezar
 *        = F       si el subperíodo arranca desde cero (primer despliegue de capital)
 * ```
 *
 * Esta es la pieza del **TWR real**: en vez de estimar el capital medio del mes con
 * pesos por día, se valúa la cartera en cada fecha en que entra o sale capital y se
 * mide cada tramo contra el capital que efectivamente había al empezarlo.
 *
 * Reemplaza a Modified Dietz, que dividía por el capital medio ponderado del mes
 * calendario. Ese denominador **colapsa** cuando el capital entra sobre el final del
 * mes: con compras los días 27 y 31 de un mes de 31 días, el capital medio queda en
 * ~9 % del invertido y una caída real del 11 % se reporta como −131 %. El error es
 * peor justo en el primer mes de una cartera, que es cuando todo el capital es nuevo.
 *
 * Devuelve `null` si no hay base sobre la que medir (tramo sin cartera y sin capital
 * nuevo): no hay rendimiento definible sobre una base nula.
 */
export function subPeriodReturn(
  previousValue: number,
  currentValue: number,
  flow: number
): number | null {
  if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue)) return null;
  if (!Number.isFinite(flow)) return null;

  const base = previousValue > 0 ? previousValue : flow;
  if (base <= 0) return null;

  const gain = currentValue - previousValue - flow;
  const result = (gain / base) * 100;

  if (!Number.isFinite(result)) return null;
  return Math.max(MIN_RETURN_PERCENT, result);
}

/**
 * Encadena los subperíodos de un mes en el rendimiento mensual: `Π (1 + r_k) − 1`.
 *
 * Un tramo sin base medible se saltea (factor 1) en vez de anular el mes entero.
 * Devuelve `null` solo si ningún tramo del mes fue medible.
 */
export function combineSubPeriods(subReturns: Array<number | null>): number | null {
  let factor = 1;
  let measured = false;

  for (const subReturn of subReturns) {
    if (subReturn === null || !Number.isFinite(subReturn)) continue;
    factor *= 1 + Math.max(MIN_RETURN_PERCENT, subReturn) / 100;
    measured = true;
  }

  if (!measured) return null;
  return Math.max(MIN_RETURN_PERCENT, (factor - 1) * 100);
}

/**
 * Encadena rendimientos mensuales en acumulados: `Π (1 + R_m) − 1`.
 *
 * **No es la suma de los mensuales.** Es la diferencia entre un número correcto y
 * uno que se va desviando cada vez más a medida que pasan los meses.
 *
 * Un mes con `null` se trata como factor 1 (no hubo variación medible) en vez de
 * cortar la serie: propagar el `null` hacia adelante haría que un solo mes sin base
 * comparable destruya todo el acumulado posterior. Los meses previos al primer dato
 * medible sí quedan en `null`, porque ahí realmente no hay nada que acumular.
 */
export function chainReturns(monthlyReturns: Array<number | null>): Array<number | null> {
  const cumulative: Array<number | null> = [];
  let factor = 1;
  let started = false;

  for (const monthly of monthlyReturns) {
    if (monthly !== null && Number.isFinite(monthly)) {
      // Acotar a −100 % antes de multiplicar: un factor negativo invertiría el signo
      // de todos los meses siguientes y el acumulado dejaría de tener sentido.
      factor *= 1 + Math.max(MIN_RETURN_PERCENT, monthly) / 100;
      factor = Math.max(0, factor);
      started = true;
    }
    cumulative.push(started ? (factor - 1) * 100 : null);
  }

  return cumulative;
}

/**
 * Anualiza un rendimiento acumulado: `(1 + R)^(12/meses) − 1`.
 *
 * Con menos de 12 meses esto **extrapola**, así que el consumidor debería avisarlo
 * o no mostrarlo. Devuelve `null` si el acumulado implica perder más del 100 %
 * (base negativa: la potencia fraccionaria no está definida en reales).
 */
export function annualizeReturn(
  cumulativePercent: number | null,
  months: number
): number | null {
  if (cumulativePercent === null || !Number.isFinite(cumulativePercent)) return null;
  if (!Number.isFinite(months) || months <= 0) return null;

  const base = 1 + cumulativePercent / 100;
  if (base <= 0) return null;

  const result = (Math.pow(base, 12 / months) - 1) * 100;
  return Number.isFinite(result) ? result : null;
}

/**
 * Drawdown a partir de la serie de rendimientos **acumulados**, no del valor.
 *
 * Esto es una corrección importante sobre el enfoque ingenuo: calcular el drawdown
 * sobre el valor de la cartera hace que **un retiro parezca una pérdida**. Si sacás
 * la mitad de la plata, el valor cae 50 % y el drawdown reporta −50 % aunque no
 * hayas perdido un peso. Sobre el índice de rendimiento acumulado (que ya neutraliza
 * los flujos) el drawdown mide lo que dice medir: cuánto cayó la performance desde
 * su mejor momento.
 *
 * Devuelve valores ≤ 0.
 */
export function drawdownFromCumulative(
  cumulativeReturns: Array<number | null>
): number[] {
  const drawdowns: number[] = [];
  let peak = 1;

  for (const cumulative of cumulativeReturns) {
    if (cumulative === null || !Number.isFinite(cumulative)) {
      drawdowns.push(0);
      continue;
    }
    // El índice nunca puede ser negativo: perder más del 100 % de una cartera
    // long-only es imposible, y un índice negativo produce drawdowns por debajo
    // de −100 %, que no significan nada.
    const index = Math.max(0, 1 + cumulative / 100);
    if (index > peak) peak = index;
    const drawdown = peak > 0 ? (index / peak - 1) * 100 : 0;
    drawdowns.push(Math.max(MIN_RETURN_PERCENT, Math.min(0, drawdown)));
  }

  return drawdowns;
}

/**
 * Rendimiento no realizado de un conjunto de posiciones: `valor / costo − 1`.
 *
 * Devuelve `null` si el costo agregado es ≤ 0 (no hay base sobre la que medir).
 */
export function unrealizedReturn(marketValue: number, costBasis: number): number | null {
  if (!Number.isFinite(marketValue) || !Number.isFinite(costBasis)) return null;
  if (costBasis <= 0) return null;
  const result = (marketValue / costBasis - 1) * 100;
  return Number.isFinite(result) ? result : null;
}

/**
 * Acumula una serie de variaciones porcentuales mensuales (inflación, índices).
 *
 * Mismo encadenamiento que `chainReturns`, expuesto aparte porque la semántica de
 * entrada es distinta: acá los porcentajes vienen de una fuente externa y un `null`
 * significa "todavía no publicado" (típicamente el lag del INDEC). Ese `null` NO se
 * trata como 0 %: se propaga, porque un cero en el acumulado de inflación le regala
 * rendimiento real al portfolio. Una vez que aparece un hueco, todo lo posterior
 * queda en `null` — es más honesto que un acumulado que saltea meses en silencio.
 */
export function chainBenchmark(monthlyPercents: Array<number | null>): Array<number | null> {
  const cumulative: Array<number | null> = [];
  let factor = 1;
  let broken = false;

  for (const monthly of monthlyPercents) {
    if (broken || monthly === null || !Number.isFinite(monthly)) {
      broken = true;
      cumulative.push(null);
      continue;
    }
    factor *= 1 + monthly / 100;
    cumulative.push((factor - 1) * 100);
  }

  return cumulative;
}

/** Mes con el rendimiento más alto / más bajo de la serie. `null` si no hay ninguno medible. */
export function findExtremeMonths(
  rows: Array<{ month: string; returnPercent: number | null }>
): {
  best: { month: string; returnPercent: number } | null;
  worst: { month: string; returnPercent: number } | null;
} {
  let best: { month: string; returnPercent: number } | null = null;
  let worst: { month: string; returnPercent: number } | null = null;

  for (const row of rows) {
    if (row.returnPercent === null || !Number.isFinite(row.returnPercent)) continue;
    const candidate = { month: row.month, returnPercent: row.returnPercent };
    if (!best || candidate.returnPercent > best.returnPercent) best = candidate;
    if (!worst || candidate.returnPercent < worst.returnPercent) worst = candidate;
  }

  return { best, worst };
}
