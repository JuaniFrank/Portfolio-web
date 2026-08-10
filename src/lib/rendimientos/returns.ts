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

/** Un flujo externo de caja dentro de un mes. */
export type ExternalFlow = {
  /** Día del mes en que ocurrió, 1-based. */
  day: number;
  /** Positivo = aporte, negativo = retiro. */
  amount: number;
};

export type ModifiedDietzInput = {
  /** Valor de la cartera al cierre del mes anterior. */
  startValue: number;
  /** Valor de la cartera al cierre de este mes. */
  endValue: number;
  flows: ExternalFlow[];
  /** Días del mes calendario. */
  daysInMonth: number;
};

/**
 * Rendimiento del período por **Modified Dietz**.
 *
 * ```
 *              V_end − V_start − F
 * R  =  ─────────────────────────────────
 *          V_start + Σ (w_i · F_i)
 *
 *   w_i = (D − d_i) / D
 * ```
 *
 * ¿Por qué no `V_end / V_start − 1`? Porque con aportes eso no mide rendimiento,
 * mide variación de saldo: un aporte de $1M en una cartera de $1M daría "+100 %".
 * Modified Dietz descuenta los flujos del numerador y los pondera en el denominador
 * por el tiempo que estuvieron invertidos, así que un depósito el día 28 pesa 2/30
 * y no 1.
 *
 * ¿Por qué no TWR diario exacto? Porque exige valuar la cartera cada día en que hay
 * un flujo. Para períodos mensuales Dietz da prácticamente lo mismo a una fracción
 * del costo. El motor soporta granularidad diaria si algún día hace falta el exacto.
 *
 * Devuelve `null` cuando el capital medio invertido es ≤ 0 (mes sin cartera y sin
 * aportes, o un retiro que deja el denominador sin sentido): no hay rendimiento
 * definible sobre una base nula.
 */
export function modifiedDietzReturn(input: ModifiedDietzInput): number | null {
  const { startValue, endValue, flows, daysInMonth } = input;

  if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return null;
  if (!Number.isFinite(daysInMonth) || daysInMonth <= 0) return null;

  let totalFlow = 0;
  let weightedFlow = 0;

  for (const flow of flows) {
    if (!Number.isFinite(flow.amount)) continue;
    // Un flujo del último día pesa 0 (no estuvo invertido); uno del día 1 pesa casi 1.
    const day = Math.min(Math.max(flow.day, 1), daysInMonth);
    const weight = (daysInMonth - day) / daysInMonth;
    totalFlow += flow.amount;
    weightedFlow += weight * flow.amount;
  }

  const averageCapital = startValue + weightedFlow;
  if (averageCapital <= 0) return null;

  const gain = endValue - startValue - totalFlow;
  const result = (gain / averageCapital) * 100;

  return Number.isFinite(result) ? result : null;
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
      factor *= 1 + monthly / 100;
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
    const index = 1 + cumulative / 100;
    if (index > peak) peak = index;
    drawdowns.push(peak > 0 ? Math.min(0, (index / peak - 1) * 100) : 0);
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
