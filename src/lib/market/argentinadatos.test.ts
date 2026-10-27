import { describe, expect, it } from "vitest";
import { correctLaggedDates, type CclHistoryPoint } from "./argentinadatos";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const point = (iso: string, mid: number): CclHistoryPoint => ({
  date: utc(iso),
  buy: mid,
  sell: mid,
  mid,
});
/** Serie compacta "fecha → mid" para comparar sin ruido. */
const flat = (points: CclHistoryPoint[]) =>
  points.map((p) => `${p.date.toISOString().slice(0, 10)}=${p.mid}`);

describe("correctLaggedDates", () => {
  it("deja intacta una serie con fechas correctas (el sábado repite al viernes)", () => {
    // Semana 2026-08-17..23: Vie 21 = 1000, Sáb 22 y Dom 23 repiten.
    const series = [
      point("2026-08-17", 990),
      point("2026-08-18", 992),
      point("2026-08-19", 994),
      point("2026-08-20", 996),
      point("2026-08-21", 1000),
      point("2026-08-22", 1000),
      point("2026-08-23", 1000),
      point("2026-08-24", 1005),
    ];
    expect(flat(correctLaggedDates(series))).toEqual(flat(series));
  });

  it("corre un día hacia atrás una semana con la fecha atrasada", () => {
    // Datos reales: el viernes 10-23 trae el cierre del jueves; sáb-lun traen el del viernes.
    const series = [
      point("2026-10-19", 1620),
      point("2026-10-20", 1625),
      point("2026-10-21", 1630),
      point("2026-10-22", 1635),
      point("2026-10-23", 1638.7),
      point("2026-10-24", 1651.6),
      point("2026-10-25", 1651.6),
      point("2026-10-26", 1651.6),
    ];
    const result = correctLaggedDates(series);
    const byDate = new Map(flat(result).map((s) => s.split("=") as [string, string]));

    expect(byDate.get("2026-10-23")).toBe("1651.6");
    expect(byDate.get("2026-10-22")).toBe("1638.7");
    expect(byDate.get("2026-10-21")).toBe("1635");
  });

  it("en la semana de transición de correcta a atrasada gana la fila bien fechada", () => {
    // Semana 1 (08-31..09-06) correcta; semana 2 (09-07..09-13) atrasada.
    const series = [
      point("2026-08-31", 1000),
      point("2026-09-01", 1001),
      point("2026-09-02", 1002),
      point("2026-09-03", 1003),
      point("2026-09-04", 1004),
      point("2026-09-05", 1004),
      point("2026-09-06", 1004),
      // semana atrasada: lunes trae el viernes anterior
      point("2026-09-07", 1004),
      point("2026-09-08", 1010),
      point("2026-09-09", 1011),
      point("2026-09-10", 1012),
      point("2026-09-11", 1013),
      point("2026-09-12", 1014),
      point("2026-09-13", 1014),
      point("2026-09-14", 1014),
    ];
    const result = correctLaggedDates(series);
    const dates = result.map((p) => p.date.getTime());

    // Fechas únicas y ascendentes.
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));

    const byDate = new Map(flat(result).map((s) => s.split("=") as [string, string]));
    // El domingo 09-06 conserva la fila correcta (no la pisa el lunes corrido).
    expect(byDate.get("2026-09-06")).toBe("1004");
    // El lunes 09-07 pasa a ser el cierre del martes.
    expect(byDate.get("2026-09-07")).toBe("1010");
    expect(byDate.get("2026-09-11")).toBe("1014");
  });

  it("la semana parcial del final hereda el régimen de la última semana detectada", () => {
    const series = [
      point("2026-10-19", 1620),
      point("2026-10-20", 1625),
      point("2026-10-21", 1630),
      point("2026-10-22", 1635),
      point("2026-10-23", 1638.7),
      point("2026-10-24", 1651.6),
      point("2026-10-25", 1651.6),
      point("2026-10-26", 1651.6),
      // Semana en curso, sin sábado todavía.
      point("2026-10-27", 1660),
    ];
    const byDate = new Map(
      flat(correctLaggedDates(series)).map((s) => s.split("=") as [string, string])
    );

    // El lunes 10-26 recibe el cierre real del lunes (fila fechada 10-27).
    expect(byDate.get("2026-10-26")).toBe("1660");
    expect(byDate.has("2026-10-27")).toBe(false);
  });

  it("no toca las filas anteriores a la primera semana detectable", () => {
    const series = [
      point("2026-08-10", 900),
      point("2026-08-11", 901),
      point("2026-08-12", 902),
    ];
    expect(flat(correctLaggedDates(series))).toEqual(flat(series));
  });

  it("revierte solo si la fuente se arregla: semana atrasada seguida de una correcta", () => {
    const series = [
      // semana atrasada (10-05..11)
      point("2026-10-05", 1500),
      point("2026-10-06", 1510),
      point("2026-10-07", 1511),
      point("2026-10-08", 1512),
      point("2026-10-09", 1513),
      point("2026-10-10", 1514),
      point("2026-10-11", 1514),
      // semana correcta (10-12..18): el sábado repite al viernes
      point("2026-10-12", 1514),
      point("2026-10-13", 1520),
      point("2026-10-14", 1521),
      point("2026-10-15", 1522),
      point("2026-10-16", 1523),
      point("2026-10-17", 1523),
      point("2026-10-18", 1523),
    ];
    const byDate = new Map(
      flat(correctLaggedDates(series)).map((s) => s.split("=") as [string, string])
    );

    // Semana atrasada: viernes 10-09 = fila del sábado.
    expect(byDate.get("2026-10-09")).toBe("1514");
    // Semana correcta: viernes 10-16 sin tocar.
    expect(byDate.get("2026-10-16")).toBe("1523");
    expect(byDate.get("2026-10-17")).toBe("1523");
  });
});
