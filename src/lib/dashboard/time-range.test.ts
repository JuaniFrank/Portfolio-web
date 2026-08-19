import { describe, expect, it } from "vitest";
import {
  RANGE_PRESETS,
  clampToSeries,
  resolveRangeWindow,
  sliceByRange,
  type TimeRange,
} from "./time-range";

const preset = (id: TimeRange["preset"]): TimeRange => ({ preset: id, from: null, to: null });
const custom = (from: string | null, to: string | null): TimeRange => ({
  preset: "CUSTOM",
  from,
  to,
});

/** Puntos al día 1 de cada mes, de 2025-06 a 2026-08. */
const points = [
  "2025-06-01",
  "2025-07-01",
  "2025-08-01",
  "2025-09-01",
  "2025-10-01",
  "2025-11-01",
  "2025-12-01",
  "2026-01-01",
  "2026-02-01",
  "2026-03-01",
  "2026-04-01",
  "2026-05-01",
  "2026-06-01",
  "2026-07-01",
  "2026-08-01",
].map((date) => ({ date }));

const dates = (rows: Array<{ date: string }>) => rows.map((row) => row.date);
const REFERENCE = "2026-08-18";

describe("RANGE_PRESETS", () => {
  it("cubre los mismos rangos que /monitoreo más el personalizado", () => {
    expect(RANGE_PRESETS.map((option) => option.id)).toEqual([
      "1M",
      "3M",
      "6M",
      "1Y",
      "ALL",
      "CUSTOM",
    ]);
  });

  it("usa los mismos días hacia atrás que `filterBarsByRange`", () => {
    const days = Object.fromEntries(RANGE_PRESETS.map((o) => [o.id, o.days]));
    expect(days).toMatchObject({ "1M": 30, "3M": 90, "6M": 180, "1Y": 365, ALL: null });
  });
});

describe("resolveRangeWindow", () => {
  it("ALL no impone límites", () => {
    expect(resolveRangeWindow(preset("ALL"), REFERENCE)).toEqual({ from: null, to: null });
  });

  it("descuenta los días del preset desde la fecha de referencia", () => {
    expect(resolveRangeWindow(preset("1M"), REFERENCE)).toEqual({
      from: "2026-07-19",
      to: REFERENCE,
    });
    expect(resolveRangeWindow(preset("3M"), REFERENCE)).toEqual({
      from: "2026-05-20",
      to: REFERENCE,
    });
  });

  it("cruza el año hacia atrás sin romperse", () => {
    expect(resolveRangeWindow(preset("1Y"), "2026-01-15").from).toBe("2025-01-15");
  });

  it("respeta el año bisiesto al restar", () => {
    expect(resolveRangeWindow(preset("1M"), "2028-03-15").from).toBe("2028-02-14");
  });

  it("devuelve los extremos del rango personalizado tal cual", () => {
    expect(resolveRangeWindow(custom("2026-02-10", "2026-04-20"), REFERENCE)).toEqual({
      from: "2026-02-10",
      to: "2026-04-20",
    });
  });

  it("acepta un rango personalizado abierto de un lado", () => {
    expect(resolveRangeWindow(custom("2026-02-10", null), REFERENCE)).toEqual({
      from: "2026-02-10",
      to: null,
    });
    expect(resolveRangeWindow(custom(null, "2026-04-20"), REFERENCE)).toEqual({
      from: null,
      to: "2026-04-20",
    });
  });

  it("da vuelta un rango personalizado invertido en vez de devolver nada", () => {
    // El calendario permite clickear el `to` antes del `from`. Devolver una ventana
    // vacía dejaría el gráfico en blanco sin explicar por qué.
    expect(resolveRangeWindow(custom("2026-04-20", "2026-02-10"), REFERENCE)).toEqual({
      from: "2026-02-10",
      to: "2026-04-20",
    });
  });
});

describe("sliceByRange", () => {
  it("ALL devuelve la serie completa", () => {
    expect(sliceByRange(points, preset("ALL"), REFERENCE)).toHaveLength(points.length);
  });

  it("6M deja solo los últimos seis meses", () => {
    expect(dates(sliceByRange(points, preset("6M"), REFERENCE))).toEqual([
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
      "2026-08-01",
    ]);
  });

  it("incluye los extremos de la ventana", () => {
    expect(dates(sliceByRange(points, custom("2026-03-01", "2026-05-01"), REFERENCE))).toEqual([
      "2026-03-01",
      "2026-04-01",
      "2026-05-01",
    ]);
  });

  it("preserva el orden de la serie", () => {
    const sliced = dates(sliceByRange(points, preset("1Y"), REFERENCE));
    expect(sliced).toEqual([...sliced].sort());
  });

  it("un rango personalizado sin extremos equivale a ALL", () => {
    expect(sliceByRange(points, custom(null, null), REFERENCE)).toHaveLength(points.length);
  });

  it("devuelve vacío si la ventana no toca ningún punto", () => {
    expect(sliceByRange(points, custom("2024-01-01", "2024-06-01"), REFERENCE)).toEqual([]);
  });

  it("tolera una serie vacía", () => {
    expect(sliceByRange([], preset("3M"), REFERENCE)).toEqual([]);
  });

  it("no recalcula nada de los puntos: los devuelve por referencia", () => {
    // Los `changeArs` y los movers de cada punto se calcularon contra su cierre anterior
    // en la serie completa. Recortar la vista no los invalida, y recalcularlos sí sería
    // un error: el primer punto visible tiene un resultado real contra un cierre que
    // ahora quedó fuera de la ventana.
    const rich = [{ date: "2026-07-01", changeArs: 500 }];
    expect(sliceByRange(rich, preset("3M"), REFERENCE)[0]).toBe(rich[0]);
  });
});

describe("clampToSeries", () => {
  it("acota los extremos seleccionables a lo que hay en la serie", () => {
    expect(clampToSeries(points)).toEqual({ min: "2025-06-01", max: "2026-08-01" });
  });

  it("devuelve null sin puntos: no hay nada que elegir", () => {
    expect(clampToSeries([])).toEqual({ min: null, max: null });
  });
});
