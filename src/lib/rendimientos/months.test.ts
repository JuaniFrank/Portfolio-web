import { describe, expect, it } from "vitest";
import {
  dayOfMonth,
  daysInMonth,
  enumerateMonths,
  formatMonthLabel,
  formatMonthLong,
  isOnOrBeforeUtcDay,
  monthEnd,
  monthKey,
  monthStart,
  parseMonthKey,
  previousMonth,
  toUtcDay,
} from "./months";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("monthKey", () => {
  it("formatea con mes de dos dígitos", () => {
    expect(monthKey(utc("2026-08-10"))).toBe("2026-08");
    expect(monthKey(utc("2026-01-01"))).toBe("2026-01");
  });

  it("usa UTC y no el huso local", () => {
    // 31 de enero a las 23:00 UTC sigue siendo enero, sin importar dónde corra el server.
    expect(monthKey(new Date("2026-01-31T23:00:00.000Z"))).toBe("2026-01");
  });
});

describe("monthStart / monthEnd / daysInMonth", () => {
  it("delimita el mes a medianoche UTC", () => {
    expect(monthStart("2026-08").toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(monthEnd("2026-08").toISOString()).toBe("2026-08-31T00:00:00.000Z");
  });

  it("resuelve meses de 30 días", () => {
    expect(monthEnd("2026-04").toISOString()).toBe("2026-04-30T00:00:00.000Z");
    expect(daysInMonth("2026-04")).toBe(30);
  });

  it("resuelve febrero no bisiesto", () => {
    expect(daysInMonth("2026-02")).toBe(28);
  });

  it("resuelve febrero bisiesto", () => {
    expect(daysInMonth("2028-02")).toBe(29);
    expect(monthEnd("2028-02").toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("resuelve diciembre sin desbordar al año siguiente", () => {
    expect(monthEnd("2026-12").toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(daysInMonth("2026-12")).toBe(31);
  });
});

describe("previousMonth", () => {
  it("retrocede dentro del mismo año", () => {
    expect(previousMonth("2026-08")).toBe("2026-07");
  });

  it("cruza el cambio de año", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});

describe("parseMonthKey", () => {
  it("devuelve el mes como índice base 0", () => {
    expect(parseMonthKey("2026-08")).toEqual({ year: 2026, monthIndex: 7 });
  });
});

describe("dayOfMonth", () => {
  it("es 1-based", () => {
    expect(dayOfMonth(utc("2026-08-01"))).toBe(1);
    expect(dayOfMonth(utc("2026-08-31"))).toBe(31);
  });
});

describe("toUtcDay / isOnOrBeforeUtcDay", () => {
  it("trunca la hora a medianoche UTC", () => {
    expect(toUtcDay(new Date("2025-10-31T12:00:00.000Z")).toISOString()).toBe(
      "2025-10-31T00:00:00.000Z"
    );
  });

  it("una operación del último día del mes ENTRA en el cierre de ese mes", () => {
    // Regresión: `tradeDate` se guarda a mediodía UTC y el cierre de mes es
    // medianoche UTC. Comparando instantes, las compras del 31 quedaban fuera de la
    // valuación de octubre mientras su capital sí contaba como flujo, y eso producía
    // una pérdida inventada del tamaño exacto de esas compras (-100 % en 10/2025).
    const compra = new Date("2025-10-31T12:00:00.000Z");
    const cierre = new Date("2025-10-31T00:00:00.000Z");
    expect(isOnOrBeforeUtcDay(compra, cierre)).toBe(true);
  });

  it("una operación del día siguiente NO entra", () => {
    expect(
      isOnOrBeforeUtcDay(new Date("2025-11-01T00:00:00.000Z"), new Date("2025-10-31T00:00:00.000Z"))
    ).toBe(false);
  });

  it("una operación anterior entra", () => {
    expect(
      isOnOrBeforeUtcDay(new Date("2025-10-27T12:00:00.000Z"), new Date("2025-10-31T00:00:00.000Z"))
    ).toBe(true);
  });

  it("no depende del huso horario del server", () => {
    // 2025-10-31 21:00 ART = 2025-11-01 00:00 UTC → es noviembre en UTC, y el motor
    // trabaja en UTC de punta a punta.
    expect(
      isOnOrBeforeUtcDay(new Date("2025-11-01T00:00:00.000Z"), new Date("2025-10-31T23:59:59.999Z"))
    ).toBe(false);
  });
});

describe("enumerateMonths", () => {
  it("incluye ambos extremos", () => {
    expect(enumerateMonths(utc("2026-06-15"), utc("2026-08-02"))).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("devuelve un solo mes cuando ambas fechas caen en el mismo", () => {
    expect(enumerateMonths(utc("2026-08-01"), utc("2026-08-31"))).toEqual(["2026-08"]);
  });

  it("cruza años", () => {
    expect(enumerateMonths(utc("2025-11-20"), utc("2026-02-05"))).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("devuelve vacío si el rango está invertido", () => {
    expect(enumerateMonths(utc("2026-08-01"), utc("2026-01-01"))).toEqual([]);
  });

  it("cubre un rango largo sin saltear meses", () => {
    const months = enumerateMonths(utc("2020-01-01"), utc("2026-08-01"));
    expect(months).toHaveLength(6 * 12 + 8);
    expect(months[0]).toBe("2020-01");
    expect(months.at(-1)).toBe("2026-08");
  });
});

describe("formateo para UI", () => {
  it("formatMonthLabel usa MM/AAAA", () => {
    expect(formatMonthLabel("2026-08")).toBe("08/2026");
  });

  it("formatMonthLong nombra el mes en castellano", () => {
    expect(formatMonthLong("2026-08")).toBe("Agosto 2026");
    expect(formatMonthLong("2026-01")).toBe("Enero 2026");
    expect(formatMonthLong("2026-12")).toBe("Diciembre 2026");
  });
});
