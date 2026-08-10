import { describe, expect, it } from "vitest";
import { PriceIndex, TimeSeries } from "./price-series";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("TimeSeries.asOf", () => {
  const series = new TimeSeries([
    { date: utc("2026-01-02"), value: 100 },
    { date: utc("2026-01-05"), value: 110 },
    { date: utc("2026-01-09"), value: 120 },
  ]);

  it("devuelve el punto exacto cuando la fecha existe", () => {
    const hit = series.asOf(utc("2026-01-05"));
    expect(hit?.value).toBe(110);
    expect(hit?.date.toISOString()).toBe(utc("2026-01-05").toISOString());
  });

  it("arrastra el último precio conocido cuando el día no operó", () => {
    // Fin de semana / feriado: la valuación usa el cierre anterior, no interpola.
    const hit = series.asOf(utc("2026-01-07"));
    expect(hit?.value).toBe(110);
    expect(hit?.date.toISOString()).toBe(utc("2026-01-05").toISOString());
  });

  it("devuelve el último punto para fechas posteriores al final de la serie", () => {
    expect(series.asOf(utc("2026-03-01"))?.value).toBe(120);
  });

  it("devuelve null antes del inicio: no extrapola hacia atrás", () => {
    // Inventar un precio anterior al primero conocido sería fabricar dato.
    expect(series.asOf(utc("2025-12-31"))).toBeNull();
  });

  it("devuelve null en una serie vacía", () => {
    expect(new TimeSeries([]).asOf(utc("2026-01-01"))).toBeNull();
  });

  it("devuelve null ante una fecha inválida", () => {
    expect(series.asOf(new Date("no-es-fecha"))).toBeNull();
  });
});

describe("TimeSeries constructor", () => {
  it("ordena puntos desordenados", () => {
    const series = new TimeSeries([
      { date: utc("2026-01-09"), value: 120 },
      { date: utc("2026-01-02"), value: 100 },
    ]);
    expect(series.first?.value).toBe(100);
    expect(series.last?.value).toBe(120);
    expect(series.asOf(utc("2026-01-05"))?.value).toBe(100);
  });

  it("ante fechas duplicadas gana el último valor visto", () => {
    const series = new TimeSeries([
      { date: utc("2026-01-02"), value: 100 },
      { date: utc("2026-01-02"), value: 105 },
    ]);
    expect(series.length).toBe(1);
    expect(series.asOf(utc("2026-01-02"))?.value).toBe(105);
  });

  it("descarta valores no finitos en vez de propagarlos", () => {
    const series = new TimeSeries([
      { date: utc("2026-01-02"), value: 100 },
      { date: utc("2026-01-03"), value: Number.NaN },
    ]);
    expect(series.length).toBe(1);
    expect(series.asOf(utc("2026-01-03"))?.value).toBe(100);
  });

  it("expone first/last como null cuando está vacía", () => {
    const empty = new TimeSeries([]);
    expect(empty.first).toBeNull();
    expect(empty.last).toBeNull();
    expect(empty.length).toBe(0);
  });
});

describe("PriceIndex", () => {
  const index = new PriceIndex([
    { instrumentId: "aapl", date: utc("2026-01-02"), close: 24000 },
    { instrumentId: "aapl", date: utc("2026-01-09"), close: 24800 },
    { instrumentId: "ggal", date: utc("2026-01-05"), close: 7000 },
  ]);

  it("separa las series por instrumento", () => {
    expect(index.asOf("aapl", utc("2026-01-09"))?.value).toBe(24800);
    expect(index.asOf("ggal", utc("2026-01-09"))?.value).toBe(7000);
  });

  it("devuelve null para un instrumento sin serie", () => {
    expect(index.asOf("desconocido", utc("2026-01-09"))).toBeNull();
    expect(index.has("desconocido")).toBe(false);
  });

  it("reporta la fecha del último precio de toda la serie", () => {
    expect(index.latestDate()?.toISOString()).toBe(utc("2026-01-09").toISOString());
  });

  it("latestDate es null cuando no hay precios", () => {
    expect(new PriceIndex([]).latestDate()).toBeNull();
  });
});
