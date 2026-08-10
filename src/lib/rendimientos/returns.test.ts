import { describe, expect, it } from "vitest";
import {
  annualizeReturn,
  chainBenchmark,
  chainReturns,
  drawdownFromCumulative,
  findExtremeMonths,
  modifiedDietzReturn,
  unrealizedReturn,
} from "./returns";

/** 30 días es el mes de referencia de los casos, salvo donde importe otro. */
const DAYS = 30;

describe("modifiedDietzReturn", () => {
  it("sin flujos equivale al retorno simple", () => {
    const result = modifiedDietzReturn({
      startValue: 1000,
      endValue: 1100,
      flows: [],
      daysInMonth: DAYS,
    });
    expect(result).toBeCloseTo(10, 10);
  });

  it("NO infla el rendimiento cuando el aporte duplica la cartera", () => {
    // Este es el bug que tenía la versión anterior: `V_end / V_start - 1` daría
    // +100 % cuando en realidad no se ganó un peso.
    const result = modifiedDietzReturn({
      startValue: 1_000_000,
      endValue: 2_000_000,
      flows: [{ day: 1, amount: 1_000_000 }],
      daysInMonth: DAYS,
    });
    expect(result).toBeCloseTo(0, 6);
  });

  it("pondera el aporte por los días que estuvo invertido", () => {
    // Mismo aporte y misma ganancia; solo cambia el día. El aporte tardío pesa menos
    // en el denominador, así que la misma ganancia representa un rendimiento mayor.
    const early = modifiedDietzReturn({
      startValue: 1000,
      endValue: 2100,
      flows: [{ day: 1, amount: 1000 }],
      daysInMonth: DAYS,
    })!;
    const late = modifiedDietzReturn({
      startValue: 1000,
      endValue: 2100,
      flows: [{ day: 28, amount: 1000 }],
      daysInMonth: DAYS,
    })!;

    expect(late).toBeGreaterThan(early);
    // day 1  → w = 29/30 → denom = 1000 + 966.67 = 1966.67 → 100/1966.67
    expect(early).toBeCloseTo((100 / (1000 + (29 / 30) * 1000)) * 100, 8);
    // day 28 → w = 2/30  → denom = 1000 + 66.67  = 1066.67 → 100/1066.67
    expect(late).toBeCloseTo((100 / (1000 + (2 / 30) * 1000)) * 100, 8);
  });

  it("un flujo del último día no pesa nada en el capital medio", () => {
    const result = modifiedDietzReturn({
      startValue: 1000,
      endValue: 2100,
      flows: [{ day: DAYS, amount: 1000 }],
      daysInMonth: DAYS,
    });
    expect(result).toBeCloseTo(10, 10);
  });

  it("mide el primer mes aunque arranque desde cero", () => {
    // V_start = 0 pero hay un aporte el día 1: el capital medio es positivo,
    // así que el primer mes de una cartera nueva sí tiene rendimiento medible.
    const result = modifiedDietzReturn({
      startValue: 0,
      endValue: 1100,
      flows: [{ day: 1, amount: 1000 }],
      daysInMonth: DAYS,
    });
    expect(result).toBeCloseTo((100 / ((29 / 30) * 1000)) * 100, 8);
  });

  it("descuenta los retiros del numerador", () => {
    // Empieza en 1000, se retiran 200, termina en 900 → se ganaron 100.
    const result = modifiedDietzReturn({
      startValue: 1000,
      endValue: 900,
      flows: [{ day: DAYS, amount: -200 }],
      daysInMonth: DAYS,
    });
    expect(result).toBeCloseTo(10, 10);
  });

  it("devuelve null cuando no hay capital sobre el que medir", () => {
    expect(
      modifiedDietzReturn({ startValue: 0, endValue: 0, flows: [], daysInMonth: DAYS })
    ).toBeNull();
  });

  it("devuelve null si un retiro deja el capital medio en cero o negativo", () => {
    expect(
      modifiedDietzReturn({
        startValue: 1000,
        endValue: 0,
        flows: [{ day: 1, amount: -2000 }],
        daysInMonth: DAYS,
      })
    ).toBeNull();
  });

  it("devuelve null ante entradas no finitas en vez de propagar NaN", () => {
    expect(
      modifiedDietzReturn({
        startValue: Number.NaN,
        endValue: 100,
        flows: [],
        daysInMonth: DAYS,
      })
    ).toBeNull();
    expect(
      modifiedDietzReturn({ startValue: 100, endValue: 110, flows: [], daysInMonth: 0 })
    ).toBeNull();
  });

  it("usa los días reales del mes al ponderar", () => {
    // Mismo día calendario, distinto largo de mes → distinto peso.
    const febrero = modifiedDietzReturn({
      startValue: 1000,
      endValue: 2100,
      flows: [{ day: 14, amount: 1000 }],
      daysInMonth: 28,
    })!;
    const enero = modifiedDietzReturn({
      startValue: 1000,
      endValue: 2100,
      flows: [{ day: 14, amount: 1000 }],
      daysInMonth: 31,
    })!;
    expect(febrero).not.toBeCloseTo(enero, 6);
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
    // El acumulado no es la suma de los mensuales.
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
    // Es el lag del INDEC: rellenar con 0 le regalaría rendimiento real al portfolio.
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
    // 10 % en 6 meses → (1,1)^2 − 1 = 21 %.
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
    // Pico en índice 1,10; cae a 1,045 → −5 %.
    const drawdowns = drawdownFromCumulative([10, 4.5]);
    expect(drawdowns[0]).toBe(0);
    expect(drawdowns[1]).toBeCloseTo((1.045 / 1.1 - 1) * 100, 8);
  });

  it("nunca devuelve valores positivos", () => {
    for (const drawdown of drawdownFromCumulative([10, -5, 30, -50, 0])) {
      expect(drawdown).toBeLessThanOrEqual(0);
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
