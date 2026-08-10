import { describe, expect, it } from "vitest";
import { buildIndexBenchmark, buildInflationBenchmark, BENCHMARK_META } from "./benchmarks";
import { TimeSeries } from "./price-series";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("BENCHMARK_META", () => {
  it("compara cada benchmark contra la serie de su propia moneda", () => {
    // Un portfolio medido en USD contra el Merval en pesos no dice nada.
    expect(BENCHMARK_META.IPC_AR.currency).toBe("ARS");
    expect(BENCHMARK_META.MERVAL.currency).toBe("ARS");
    expect(BENCHMARK_META.SP500.currency).toBe("USD");
  });
});

describe("buildIndexBenchmark", () => {
  const levels = new TimeSeries([
    { date: utc("2025-12-31"), value: 1000 },
    { date: utc("2026-01-30"), value: 1100 },
    { date: utc("2026-02-27"), value: 1045 },
  ]);

  it("deriva la variación mensual entre cierres de fin de mes", () => {
    const series = buildIndexBenchmark("MERVAL", ["2026-01", "2026-02"], levels);
    expect(series.points[0]!.monthlyPercent).toBeCloseTo(10, 8);
    expect(series.points[1]!.monthlyPercent).toBeCloseTo(-5, 8);
  });

  it("acumula por producto", () => {
    const series = buildIndexBenchmark("MERVAL", ["2026-01", "2026-02"], levels);
    expect(series.points[1]!.cumulativePercent).toBeCloseTo((1.1 * 0.95 - 1) * 100, 8);
  });

  it("toma el último cierre disponible cuando fin de mes cae en día no hábil", () => {
    // 2026-01-31 es sábado: usa el cierre del 30, no deja el mes sin dato.
    const series = buildIndexBenchmark("MERVAL", ["2026-01"], levels);
    expect(series.points[0]!.monthlyPercent).not.toBeNull();
  });

  it("deja el primer mes en null si falta el cierre anterior", () => {
    const sinPrevio = new TimeSeries([{ date: utc("2026-01-30"), value: 1100 }]);
    const series = buildIndexBenchmark("MERVAL", ["2026-01"], sinPrevio);
    expect(series.points[0]!.monthlyPercent).toBeNull();
    expect(series.available).toBe(false);
  });

  it("marca available=false con serie vacía", () => {
    const series = buildIndexBenchmark("SP500", ["2026-01"], new TimeSeries([]));
    expect(series.available).toBe(false);
    expect(series.lastAvailableMonth).toBeNull();
  });
});

describe("buildInflationBenchmark", () => {
  // El INDEC fecha cada dato a fin de mes: 2026-01-31 = inflación de enero.
  const published = [
    { date: utc("2026-01-31"), value: 2.9 },
    { date: utc("2026-02-28"), value: 2.9 },
    { date: utc("2026-03-31"), value: 3.4 },
  ];

  it("usa el valor publicado como variación mensual, sin derivar nada", () => {
    const series = buildInflationBenchmark(["2026-01", "2026-02", "2026-03"], published);
    expect(series.points.map((point) => point.monthlyPercent)).toEqual([2.9, 2.9, 3.4]);
  });

  it("acumula por producto y no por suma", () => {
    const series = buildInflationBenchmark(["2026-01", "2026-02", "2026-03"], published);
    const expected = (1.029 * 1.029 * 1.034 - 1) * 100;
    expect(series.points.at(-1)!.cumulativePercent).toBeCloseTo(expected, 8);
    expect(series.points.at(-1)!.cumulativePercent).not.toBeCloseTo(2.9 + 2.9 + 3.4, 2);
  });

  it("deja en null los meses no publicados en vez de asumir 0 %", () => {
    // Lag del INDEC: un 0 en el acumulado de inflación le regala rendimiento real
    // al portfolio durante todo el período sin publicar.
    const series = buildInflationBenchmark(
      ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"],
      published
    );
    expect(series.points[3]!.monthlyPercent).toBeNull();
    expect(series.points[3]!.cumulativePercent).toBeNull();
    expect(series.points[4]!.cumulativePercent).toBeNull();
  });

  it("reporta el último mes con dato dentro del período", () => {
    const series = buildInflationBenchmark(
      ["2026-01", "2026-02", "2026-03", "2026-04"],
      published
    );
    expect(series.lastAvailableMonth).toBe("2026-03");
    expect(series.available).toBe(true);
  });

  it("ignora meses del período anteriores a la serie publicada", () => {
    const series = buildInflationBenchmark(["2025-11", "2025-12", "2026-01"], published);
    expect(series.points[0]!.monthlyPercent).toBeNull();
    expect(series.points[2]!.monthlyPercent).toBe(2.9);
  });

  it("marca available=false sin datos publicados", () => {
    const series = buildInflationBenchmark(["2026-01"], []);
    expect(series.available).toBe(false);
  });
});
