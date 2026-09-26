import { describe, expect, it } from "vitest";
import { TimeSeries } from "@/lib/rendimientos/price-series";
import { buildBondDailyPriceSeries } from "./bond-price-series";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const at = (iso: string) => new Date(iso);

describe("buildBondDailyPriceSeries", () => {
  it("el cierre real gana contra la estimación cuando hay snapshot ese día", () => {
    const result = buildBondDailyPriceSeries({
      days: [utc("2026-09-20")],
      snapshots: [
        // Fuera de orden a propósito: gana el de timestamp más tardío, no el
        // último del array.
        { datetime: at("2026-09-20T11:00:00.000Z"), close: 159000 },
        { datetime: at("2026-09-20T14:00:00.000Z"), close: 160100 },
      ],
      schedule: [],
      ccl: new TimeSeries([{ date: utc("2026-09-20"), value: 1500 }]),
    });

    expect(result).toEqual([
      { date: "2026-09-20", priceArsPerVn: 1601, estimated: false },
    ]);
  });

  it("convierte el cierre real de ARS por 100 VN a ARS por VN (÷100)", () => {
    const result = buildBondDailyPriceSeries({
      days: [utc("2026-09-21")],
      snapshots: [{ datetime: at("2026-09-21T13:00:00.000Z"), close: 155000 }],
      schedule: [],
      ccl: new TimeSeries([]),
    });

    expect(result[0]!.priceArsPerVn).toBe(1550);
  });

  it("sin snapshot real, estima como fracción residual × USD 1 × CCL del día", () => {
    const result = buildBondDailyPriceSeries({
      days: [utc("2026-01-15")],
      snapshots: [],
      // 70% de residual desde el 1/1: ya hubo una amortización parcial.
      schedule: [{ paymentDate: "2026-01-01", residualValue: 70 }],
      ccl: new TimeSeries([{ date: utc("2026-01-10"), value: 1000 }]),
    });

    expect(result).toEqual([
      { date: "2026-01-15", priceArsPerVn: 700, estimated: true },
    ]);
  });

  it("antes de la primera amortización, la fracción residual es 1 (par completo)", () => {
    const result = buildBondDailyPriceSeries({
      days: [utc("2025-12-01")],
      snapshots: [],
      schedule: [{ paymentDate: "2026-01-01", residualValue: 70 }],
      ccl: new TimeSeries([{ date: utc("2025-11-01"), value: 900 }]),
    });

    expect(result[0]!.priceArsPerVn).toBe(900);
  });

  it("usa la última amortización aplicable cuando hay varias filas", () => {
    const result = buildBondDailyPriceSeries({
      days: [utc("2026-06-01")],
      snapshots: [],
      schedule: [
        { paymentDate: "2026-01-01", residualValue: 70 },
        { paymentDate: "2026-04-01", residualValue: 40 },
      ],
      ccl: new TimeSeries([{ date: utc("2026-05-01"), value: 1200 }]),
    });

    expect(result[0]!.priceArsPerVn).toBe(480); // 0.40 × 1 × 1200
  });

  it("sin CCL previo al día y sin snapshot real, el día se omite (no se inventa precio)", () => {
    const result = buildBondDailyPriceSeries({
      days: [utc("2020-01-01")],
      snapshots: [],
      schedule: [],
      ccl: new TimeSeries([{ date: utc("2026-01-01"), value: 1000 }]),
    });

    expect(result).toEqual([]);
  });

  it("arrastra el último CCL conocido cuando el día estimado no tiene cotización propia", () => {
    const result = buildBondDailyPriceSeries({
      days: [utc("2026-02-10")],
      snapshots: [],
      schedule: [],
      ccl: new TimeSeries([
        { date: utc("2026-01-01"), value: 1000 },
        { date: utc("2026-01-15"), value: 1100 },
      ]),
    });

    expect(result[0]!.priceArsPerVn).toBe(1100);
    expect(result[0]!.estimated).toBe(true);
  });

  it("procesa varios días mezclando real, estimado y omitido", () => {
    const result = buildBondDailyPriceSeries({
      days: [utc("2020-01-01"), utc("2026-09-20"), utc("2026-01-15")],
      snapshots: [{ datetime: at("2026-09-20T14:00:00.000Z"), close: 160100 }],
      schedule: [],
      ccl: new TimeSeries([{ date: utc("2026-01-10"), value: 1000 }]),
    });

    expect(result.map((p) => p.date)).toEqual(["2026-09-20", "2026-01-15"]);
    expect(result[0]).toEqual({ date: "2026-09-20", priceArsPerVn: 1601, estimated: false });
    expect(result[1]).toEqual({ date: "2026-01-15", priceArsPerVn: 1000, estimated: true });
  });
});
