import { describe, expect, it } from "vitest";
import { overlayLiveCcl, overlayLivePrices } from "./live-overlay";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const AAPL = "inst-aapl";
const GGAL = "inst-ggal";
const TODAY = utc("2026-09-23");

describe("overlayLivePrices", () => {
  it("agrega un punto de hoy con el precio en vivo cuando no hay cierre EOD de hoy", () => {
    const result = overlayLivePrices(
      [{ instrumentId: AAPL, date: utc("2026-09-22"), close: 100 }],
      [{ instrumentId: AAPL, price: 105 }],
      TODAY
    );

    expect(result.rows).toContainEqual({ instrumentId: AAPL, date: TODAY, close: 105 });
    expect(result.liveInstrumentIds.has(AAPL)).toBe(true);
  });

  it("el cierre EOD de hoy gana: no agrega el punto en vivo ni lo marca", () => {
    const result = overlayLivePrices(
      [{ instrumentId: AAPL, date: TODAY, close: 110 }],
      [{ instrumentId: AAPL, price: 105 }],
      TODAY
    );

    expect(result.rows).toEqual([{ instrumentId: AAPL, date: TODAY, close: 110 }]);
    expect(result.liveInstrumentIds.has(AAPL)).toBe(false);
  });

  it("ignora cotizaciones nulas, no finitas o <= 0", () => {
    const result = overlayLivePrices(
      [],
      [
        { instrumentId: AAPL, price: null },
        { instrumentId: GGAL, price: 0 },
        { instrumentId: "inst-neg", price: -5 },
        { instrumentId: "inst-nan", price: Number.NaN },
      ],
      TODAY
    );

    expect(result.rows).toEqual([]);
    expect(result.liveInstrumentIds.size).toBe(0);
  });

  it("mezcla instrumentos con y sin cierre EOD de hoy de forma independiente", () => {
    const result = overlayLivePrices(
      [{ instrumentId: AAPL, date: TODAY, close: 110 }],
      [
        { instrumentId: AAPL, price: 999 },
        { instrumentId: GGAL, price: 50 },
      ],
      TODAY
    );

    expect(result.rows).toEqual([
      { instrumentId: AAPL, date: TODAY, close: 110 },
      { instrumentId: GGAL, date: TODAY, close: 50 },
    ]);
    expect(result.liveInstrumentIds.has(AAPL)).toBe(false);
    expect(result.liveInstrumentIds.has(GGAL)).toBe(true);
  });

  it("no muta el arreglo original cuando no hay overlay que agregar", () => {
    const originalRows = [{ instrumentId: AAPL, date: TODAY, close: 110 }];
    const result = overlayLivePrices(originalRows, [{ instrumentId: AAPL, price: 999 }], TODAY);

    expect(result.rows).toBe(originalRows);
  });
});

describe("overlayLiveCcl", () => {
  it("agrega el mid en vivo de hoy cuando la serie no tiene punto de hoy", () => {
    const result = overlayLiveCcl(
      [{ date: utc("2026-09-22"), value: 1000 }],
      1050,
      TODAY
    );

    expect(result.points).toEqual([
      { date: utc("2026-09-22"), value: 1000 },
      { date: TODAY, value: 1050 },
    ]);
    expect(result.isLive).toBe(true);
  });

  it("el punto de hoy ya presente gana: ignora el mid en vivo", () => {
    const result = overlayLiveCcl([{ date: TODAY, value: 1000 }], 1050, TODAY);

    expect(result.points).toEqual([{ date: TODAY, value: 1000 }]);
    expect(result.isLive).toBe(false);
  });

  it("ignora un mid nulo, no finito o <= 0", () => {
    expect(overlayLiveCcl([], null, TODAY).isLive).toBe(false);
    expect(overlayLiveCcl([], 0, TODAY).isLive).toBe(false);
    expect(overlayLiveCcl([], -1, TODAY).isLive).toBe(false);
    expect(overlayLiveCcl([], Number.NaN, TODAY).isLive).toBe(false);
  });
});

describe("overlay en fin de semana", () => {
  const SATURDAY = utc("2026-09-26");

  it("no agrega precio en vivo un sábado: data912 repite el cierre del viernes", () => {
    const result = overlayLivePrices(
      [{ instrumentId: AAPL, date: utc("2026-09-25"), close: 100 }],
      [{ instrumentId: AAPL, price: 100 }],
      SATURDAY
    );

    expect(result.rows).toHaveLength(1);
    expect(result.liveInstrumentIds.size).toBe(0);
  });

  it("no agrega CCL en vivo un sábado", () => {
    const result = overlayLiveCcl([{ date: utc("2026-09-25"), value: 1200 }], 1210, SATURDAY);

    expect(result.points).toHaveLength(1);
    expect(result.isLive).toBe(false);
  });
});
