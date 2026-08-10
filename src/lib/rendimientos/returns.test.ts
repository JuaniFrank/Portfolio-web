import { describe, expect, it } from "vitest";
import {
  annualizeReturn,
  chainBenchmark,
  chainReturns,
  combineSubPeriods,
  drawdownFromCumulative,
  findExtremeMonths,
  subPeriodReturn,
  unrealizedReturn,
} from "./returns";

describe("subPeriodReturn", () => {
  it("sin capital nuevo mide la variación pura del valor", () => {
    expect(subPeriodReturn(1000, 1100, 0)).toBeCloseTo(10, 10);
  });

  it("descuenta el capital que entra: poner plata no es ganarla", () => {
    // Valor pasa de 1000 a 2000, pero 1000 fueron aporte → no hubo ganancia.
    expect(subPeriodReturn(1000, 2000, 1000)).toBeCloseTo(0, 10);
  });

  it("mide contra el capital desplegado cuando el tramo arranca desde cero", () => {
    // Primer despliegue: la base es el capital puesto, no un valor previo inexistente.
    expect(subPeriodReturn(0, 950, 1000)).toBeCloseTo(-5, 10);
    expect(subPeriodReturn(0, 1100, 1000)).toBeCloseTo(10, 10);
  });

  it("una venta a valor de mercado no genera rendimiento", () => {
    expect(subPeriodReturn(1200, 0, -1200)).toBeCloseTo(0, 10);
  });

  it("una venta por encima del valor previo sí registra ganancia", () => {
    expect(subPeriodReturn(1000, 0, -1100)).toBeCloseTo(10, 10);
  });

  it("devuelve null cuando no hay base sobre la que medir", () => {
    expect(subPeriodReturn(0, 0, 0)).toBeNull();
    expect(subPeriodReturn(0, 100, -50)).toBeNull();
  });

  it("devuelve null ante entradas no finitas en vez de propagar NaN", () => {
    expect(subPeriodReturn(Number.NaN, 100, 0)).toBeNull();
    expect(subPeriodReturn(100, Number.NaN, 0)).toBeNull();
    expect(subPeriodReturn(100, 100, Number.NaN)).toBeNull();
  });

  it("acota la pérdida a −100 %: no se puede perder más de lo invertido", () => {
    // Un valor por debajo de −100 % vuelve negativo el factor de encadenamiento y
    // arruina todos los meses siguientes.
    expect(subPeriodReturn(1000, 0, 2000)).toBe(-100);
  });
});

describe("combineSubPeriods", () => {
  it("encadena los tramos del mes por producto", () => {
    expect(combineSubPeriods([10, 10])).toBeCloseTo(21, 10);
  });

  it("saltea tramos sin base sin anular el mes entero", () => {
    expect(combineSubPeriods([10, null, 10])).toBeCloseTo(21, 10);
  });

  it("devuelve null si ningún tramo fue medible", () => {
    expect(combineSubPeriods([null, null])).toBeNull();
    expect(combineSubPeriods([])).toBeNull();
  });

  it("nunca devuelve menos de −100 %", () => {
    expect(combineSubPeriods([-100, -50])).toBe(-100);
  });
});

describe("regresión: capital que entra sobre el cierre del mes", () => {
  // Caso real del import de movimientos.xlsx, 10/2025: todas las compras cayeron los
  // días 27 y 31 de un mes de 31 días. Modified Dietz calculaba el capital medio con
  // pesos por día — (31−27)/31 = 0,129 y (31−31)/31 = 0 — y ese denominador quedaba en
  // el 8,8 % del capital invertido, así que una caída real del 11,6 % se reportaba como
  // −131,8 %. Valuando en cada fecha de operación el problema no existe.

  it("una caída del 11,6 % se reporta como 11,6 %, no como −131 %", () => {
    // Tramo 1 (día 27): se despliegan 16.861.534; cierra el día 27 en el mismo valor.
    // Tramo 2 (día 31): entran 8.087.971 más y la cartera cae.
    const dia27 = subPeriodReturn(0, 16_861_534, 16_861_534)!;
    const dia31 = subPeriodReturn(16_861_534, 22_654_612, 8_087_971)!;
    const mes = combineSubPeriods([dia27, dia31])!;

    expect(dia27).toBeCloseTo(0, 6);
    expect(mes).toBeGreaterThan(-30);
    expect(mes).toBeLessThan(0);
  });

  it("el capital del último día no puede producir un rendimiento desmedido", () => {
    // Compra el último día del mes: el tramo mide contra el capital realmente puesto.
    // Con Dietz su peso era 0 y el denominador colapsaba.
    const result = subPeriodReturn(0, 9_900, 10_000);
    expect(result).toBeCloseTo(-1, 10);
  });

  it("nunca produce un acumulado que invierta el signo de los meses siguientes", () => {
    const cumulative = chainReturns([combineSubPeriods([-100]), 5, 8]);
    // Tras una pérdida total el índice queda en 0 y ahí se queda: sin factores negativos.
    expect(cumulative.every((value) => value === null || value >= -100)).toBe(true);
    expect(cumulative.at(-1)!).toBeGreaterThanOrEqual(-100);
  });
});

describe("chainReturns", () => {
  it("acumula por producto, no por suma", () => {
    const [first, second] = chainReturns([10, 10]);
    expect(first).toBeCloseTo(10, 10);
    // 1,10 × 1,10 = 1,21 → 21 %, no 20 %.
    expect(second).toBeCloseTo(21, 10);
  });

  it("una caída no compensa una subida del mismo porcentaje", () => {
    const [, second] = chainReturns([50, -50]);
    expect(second).toBeCloseTo(-25, 10);
  });

  it("reproduce el caso de la app de referencia: mensual negativo con acumulado positivo", () => {
    const cumulative = chainReturns([14.6, -3.14, 1.82, 3.79, -15.64, 7.65]);
    expect(cumulative.at(-1)!).toBeGreaterThan(0);
    const naiveSum = 14.6 - 3.14 + 1.82 + 3.79 - 15.64 + 7.65;
    expect(cumulative.at(-1)!).not.toBeCloseTo(naiveSum, 2);
  });

  it("trata un mes null como factor 1 sin cortar la serie", () => {
    const cumulative = chainReturns([10, null, 10]);
    expect(cumulative[1]).toBeCloseTo(10, 10);
    expect(cumulative[2]).toBeCloseTo(21, 10);
  });

  it("deja en null los meses previos al primer dato medible", () => {
    const cumulative = chainReturns([null, null, 5]);
    expect(cumulative[0]).toBeNull();
    expect(cumulative[1]).toBeNull();
    expect(cumulative[2]).toBeCloseTo(5, 10);
  });

  it("acota un mes fuera de rango en vez de invertir el signo de la serie", () => {
    // Sin la cota, el factor pasaría a negativo y un mes de +5 % BAJARÍA el acumulado.
    const cumulative = chainReturns([-150, 5]);
    expect(cumulative[0]).toBe(-100);
    expect(cumulative[1]).toBe(-100);
  });

  it("devuelve serie vacía para entrada vacía", () => {
    expect(chainReturns([])).toEqual([]);
  });
});

describe("chainBenchmark", () => {
  it("acumula por producto", () => {
    const cumulative = chainBenchmark([2.9, 2.9, 3.4]);
    const expected = (1.029 * 1.029 * 1.034 - 1) * 100;
    expect(cumulative.at(-1)!).toBeCloseTo(expected, 8);
  });

  it("corta el acumulado en el primer mes sin publicar, en vez de asumir 0 %", () => {
    const cumulative = chainBenchmark([2.9, null, 3.4]);
    expect(cumulative[0]).toBeCloseTo(2.9, 10);
    expect(cumulative[1]).toBeNull();
    expect(cumulative[2]).toBeNull();
  });
});

describe("annualizeReturn", () => {
  it("deja igual un acumulado de exactamente 12 meses", () => {
    expect(annualizeReturn(20, 12)).toBeCloseTo(20, 8);
  });

  it("extrapola cuando hay menos de 12 meses", () => {
    expect(annualizeReturn(10, 6)).toBeCloseTo(21, 8);
  });

  it("devuelve null si se perdió más del 100 %", () => {
    expect(annualizeReturn(-120, 6)).toBeNull();
  });

  it("devuelve null sin meses o sin acumulado", () => {
    expect(annualizeReturn(10, 0)).toBeNull();
    expect(annualizeReturn(null, 12)).toBeNull();
  });
});

describe("drawdownFromCumulative", () => {
  it("es cero mientras la serie hace máximos nuevos", () => {
    expect(drawdownFromCumulative([5, 10, 15])).toEqual([0, 0, 0]);
  });

  it("mide la caída desde el pico del acumulado", () => {
    const drawdowns = drawdownFromCumulative([10, 4.5]);
    expect(drawdowns[0]).toBe(0);
    expect(drawdowns[1]).toBeCloseTo((1.045 / 1.1 - 1) * 100, 8);
  });

  it("nunca devuelve valores positivos", () => {
    for (const drawdown of drawdownFromCumulative([10, -5, 30, -50, 0])) {
      expect(drawdown).toBeLessThanOrEqual(0);
    }
  });

  it("NUNCA baja de −100 %", () => {
    // Un índice negativo producía drawdowns de −131 %, que no significan nada:
    // no se puede perder más del 100 % de una cartera long-only.
    for (const drawdown of drawdownFromCumulative([-131.8, -150, -99])) {
      expect(drawdown).toBeGreaterThanOrEqual(-100);
    }
  });

  it("ignora los meses sin acumulado medible", () => {
    expect(drawdownFromCumulative([null, null])).toEqual([0, 0]);
  });
});

describe("unrealizedReturn", () => {
  it("mide valor contra costo", () => {
    expect(unrealizedReturn(1200, 1000)).toBeCloseTo(20, 10);
  });

  it("devuelve null sin costo, en vez de dividir por cero", () => {
    expect(unrealizedReturn(1200, 0)).toBeNull();
    expect(unrealizedReturn(1200, -50)).toBeNull();
  });
});

describe("findExtremeMonths", () => {
  it("encuentra el mejor y el peor mes ignorando los no medibles", () => {
    const { best, worst } = findExtremeMonths([
      { month: "2026-01", returnPercent: 3.79 },
      { month: "2026-02", returnPercent: -15.64 },
      { month: "2026-03", returnPercent: null },
      { month: "2026-04", returnPercent: 7.65 },
    ]);
    expect(best).toEqual({ month: "2026-04", returnPercent: 7.65 });
    expect(worst).toEqual({ month: "2026-02", returnPercent: -15.64 });
  });

  it("devuelve null cuando ningún mes es medible", () => {
    const { best, worst } = findExtremeMonths([{ month: "2026-01", returnPercent: null }]);
    expect(best).toBeNull();
    expect(worst).toBeNull();
  });
});
