import { describe, expect, it } from "vitest";
import { computeFxDailyChange } from "./fx-daily-change";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("computeFxDailyChange", () => {
  it("calcula la variación en pesos y en porcentaje contra el cierre previo", () => {
    const result = computeFxDailyChange(1681.1, { date: utc("2026-10-25"), mid: 1651.6 });

    expect(result.mid).toBe(1681.1);
    expect(result.previousMid).toBe(1651.6);
    expect(result.previousDate).toEqual(utc("2026-10-25"));
    expect(result.changeArs).toBeCloseTo(29.5, 6);
    expect(result.changePct).toBeCloseTo(1.7862, 3);
  });

  it("devuelve variación negativa cuando el dólar baja", () => {
    const result = computeFxDailyChange(1500, { date: utc("2026-10-23"), mid: 1600 });

    expect(result.changeArs).toBeCloseTo(-100, 6);
    expect(result.changePct).toBeCloseTo(-6.25, 6);
  });

  it("devuelve cero cuando el valor de hoy repite el cierre previo", () => {
    const result = computeFxDailyChange(1560.65, { date: utc("2026-10-25"), mid: 1560.65 });

    expect(result.changeArs).toBe(0);
    expect(result.changePct).toBe(0);
  });

  it("deja la variación en null cuando no hay cierre previo", () => {
    const result = computeFxDailyChange(1681.1, null);

    expect(result).toEqual({
      mid: 1681.1,
      previousMid: null,
      previousDate: null,
      changeArs: null,
      changePct: null,
    });
  });

  it("deja la variación en null cuando el cierre previo es 0 o inválido", () => {
    for (const mid of [0, -5, Number.NaN]) {
      const result = computeFxDailyChange(1681.1, { date: utc("2026-10-25"), mid });
      expect(result.changeArs).toBeNull();
      expect(result.changePct).toBeNull();
      expect(result.previousMid).toBeNull();
    }
  });
});
