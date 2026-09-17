import { describe, expect, it } from "vitest";
import type { MonitoringBar } from "@/lib/monitoreo/types";
import { toHistoricalBars } from "./data912-eod";

/** Forma real, tomada de `GET /historical/cedears/meta` vía `fetchData912History`. */
const bar = (time: string, close: number, rest: Partial<MonitoringBar> = {}): MonitoringBar => ({
  time,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1000,
  ...rest,
});

describe("toHistoricalBars", () => {
  it("convierte `time` string a Date de medianoche UTC", () => {
    // Si esto se anclara en hora local, una rueda del 31 caería en el mes anterior
    // según dónde corra el server. Ver `months.ts`.
    const [converted] = toHistoricalBars([bar("2026-08-31", 38140)]);
    expect(converted!.date.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(converted!.close).toBe(38140);
  });

  it("preserva OHLV incluyendo los nulos", () => {
    const sinOhl = bar("2026-01-05", 100, { open: null, high: null, low: null, volume: null });
    const [converted] = toHistoricalBars([sinOhl]);
    expect(converted!.open).toBeNull();
    expect(converted!.volume).toBeNull();
    expect(converted!.close).toBe(100);
  });

  it("descarta ruedas sin cierre positivo", () => {
    // Un 0 no es 'valió cero', es un día sin dato: propagarlo daría un −100 %.
    const converted = toHistoricalBars([
      bar("2026-01-02", 0),
      bar("2026-01-03", -5),
      bar("2026-01-06", 100),
    ]);
    expect(converted).toHaveLength(1);
    expect(converted[0]!.close).toBe(100);
  });

  it("ordena por fecha y deduplica quedándose con el último valor", () => {
    const converted = toHistoricalBars([
      bar("2026-01-05", 300),
      bar("2026-01-02", 100),
      bar("2026-01-05", 350),
    ]);
    expect(converted.map((b) => b.close)).toEqual([100, 350]);
  });

  it("descarta filas con fecha inválida o ausente", () => {
    const converted = toHistoricalBars([
      bar("no-es-fecha", 100),
      { ...bar("2026-01-05", 100), time: undefined as unknown as string },
      bar("2026-01-06", 100),
    ]);
    expect(converted).toHaveLength(1);
  });

  it("con lista vacía devuelve lista vacía", () => {
    expect(toHistoricalBars([])).toEqual([]);
  });
});
