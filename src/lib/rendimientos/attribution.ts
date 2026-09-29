/**
 * "Atribución del período": cuánto empujó cada ticker/sector la ganancia del
 * período seleccionado en `/rendimientos`.
 *
 * Pura: opera sobre los meses ya recortados al período (mismo array que
 * alimenta `resolveView`/`summarizeRange`), sin recalcular el TWR. La renta
 * (dividendos y cupones) no se atribuye por ticker (`attributeMonthlyPositionGains`,
 * ver `valuation.ts`) — se muestra como una fila aparte en vez de repartirla
 * arbitrariamente. Sumar Σ posiciones + renta coincide con la ganancia del mes
 * salvo un residual medible (típicamente USD sin CCL para algún aporte); ese
 * residual se muestra como "Otros ajustes" en vez de esconderse en el total.
 */
import type { MonthlyPerformanceRow, ViewCurrency } from "./types";

export type AttributionGroupBy = "ticker" | "sector";
export type AttributionRowKind = "group" | "income" | "reconciliation";

export type AttributionRow = {
  /** Ticker o nombre de sector para las filas "group"; clave fija para las otras. */
  key: string;
  label: string;
  amount: number;
  kind: AttributionRowKind;
};

export type AttributionResult = {
  /** Grupos ordenados por contribución absoluta descendente, luego renta, luego
   * reconciliación (solo si el residual supera el umbral). */
  rows: AttributionRow[];
  /** Ganancia del período: el mismo número que "Ganancia del período" en los KPIs. */
  total: number;
};

/** Por debajo de este residual (en unidades de moneda) no vale la pena mostrar
 * una fila de reconciliación — es ruido de redondeo, no una ganancia sin atribuir. */
const RECONCILIATION_THRESHOLD = 0.5;

export function attributeReturns(
  rows: MonthlyPerformanceRow[],
  groupBy: AttributionGroupBy,
  currency: ViewCurrency,
  sectorOf: (ticker: string) => string
): AttributionResult {
  const isArs = currency === "ARS";
  const groupTotals = new Map<string, number>();
  let incomeTotal = 0;
  let periodGain = 0;

  for (const monthRow of rows) {
    periodGain += isArs ? monthRow.gainArs : monthRow.gainUsd;
    incomeTotal += isArs ? monthRow.incomeArs : monthRow.incomeUsd;

    for (const position of monthRow.positions) {
      const gain = isArs ? position.monthGainArs : position.monthGainUsd;
      if (gain === null) continue;
      const key = groupBy === "ticker" ? position.ticker : sectorOf(position.ticker);
      groupTotals.set(key, (groupTotals.get(key) ?? 0) + gain);
    }
  }

  const groupRows: AttributionRow[] = Array.from(groupTotals.entries())
    .map(([key, amount]) => ({ key, label: key, amount, kind: "group" as const }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const incomeRow: AttributionRow = {
    key: "__income__",
    label: "Renta (dividendos y cupones)",
    amount: incomeTotal,
    kind: "income",
  };

  const accountedFor =
    groupRows.reduce((sum, row) => sum + row.amount, 0) + incomeTotal;
  const residual = periodGain - accountedFor;

  const resultRows: AttributionRow[] = [...groupRows, incomeRow];
  if (Math.abs(residual) > RECONCILIATION_THRESHOLD) {
    resultRows.push({
      key: "__reconciliation__",
      label: "Otros ajustes",
      amount: residual,
      kind: "reconciliation",
    });
  }

  return { rows: resultRows, total: periodGain };
}
