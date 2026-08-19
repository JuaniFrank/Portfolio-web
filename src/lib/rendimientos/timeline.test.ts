import { describe, expect, it } from "vitest";
import {
  bucketByLastDay,
  bucketEndpoints,
  enumerateUtcDays,
  type Granularity,
} from "./timeline";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const isoAll = (dates: Date[]) => dates.map(iso);

describe("enumerateUtcDays", () => {
  it("incluye ambos extremos", () => {
    expect(isoAll(enumerateUtcDays(utc("2026-01-01"), utc("2026-01-04")))).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
  });

  it("devuelve un solo día cuando los extremos coinciden", () => {
    expect(isoAll(enumerateUtcDays(utc("2026-03-05"), utc("2026-03-05")))).toEqual([
      "2026-03-05",
    ]);
  });

  it("devuelve vacío si el rango está invertido", () => {
    expect(enumerateUtcDays(utc("2026-03-05"), utc("2026-03-04"))).toEqual([]);
  });

  it("cruza el fin de mes y el fin de año", () => {
    expect(isoAll(enumerateUtcDays(utc("2025-12-30"), utc("2026-01-02")))).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("respeta el año bisiesto", () => {
    expect(isoAll(enumerateUtcDays(utc("2028-02-28"), utc("2028-03-01")))).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("normaliza a medianoche UTC aunque los extremos traigan hora", () => {
    const from = new Date("2026-01-01T18:30:00.000Z");
    const to = new Date("2026-01-02T03:15:00.000Z");
    const days = enumerateUtcDays(from, to);
    expect(isoAll(days)).toEqual(["2026-01-01", "2026-01-02"]);
    for (const day of days) expect(day.toISOString()).toMatch(/T00:00:00\.000Z$/);
  });
});

describe("bucketEndpoints — daily", () => {
  it("devuelve todos los días del rango", () => {
    expect(isoAll(bucketEndpoints(utc("2026-01-01"), utc("2026-01-03"), "daily"))).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });
});

describe("bucketEndpoints — weekly", () => {
  // 2026-01-04 y 2026-01-11 son domingos.
  it("cierra cada semana el domingo", () => {
    expect(isoAll(bucketEndpoints(utc("2026-01-01"), utc("2026-01-11"), "weekly"))).toEqual([
      "2026-01-04",
      "2026-01-11",
    ]);
  });

  it("recorta el último bucket a `to` cuando la semana quedó incompleta", () => {
    expect(isoAll(bucketEndpoints(utc("2026-01-01"), utc("2026-01-07"), "weekly"))).toEqual([
      "2026-01-04",
      "2026-01-07",
    ]);
  });

  it("no duplica el punto cuando `to` ya es domingo", () => {
    expect(isoAll(bucketEndpoints(utc("2026-01-05"), utc("2026-01-11"), "weekly"))).toEqual([
      "2026-01-11",
    ]);
  });

  it("con un rango menor a una semana devuelve solo `to`", () => {
    expect(isoAll(bucketEndpoints(utc("2026-01-05"), utc("2026-01-07"), "weekly"))).toEqual([
      "2026-01-07",
    ]);
  });
});

describe("bucketEndpoints — monthly", () => {
  it("cierra cada mes en su último día", () => {
    expect(isoAll(bucketEndpoints(utc("2026-01-10"), utc("2026-03-31"), "monthly"))).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
  });

  it("recorta el último bucket a `to` en vez de proyectar el fin de mes", () => {
    // Es la diferencia con el motor mensual, que valúa al 31 incluso si hoy es 19:
    // en un gráfico de evolución ese punto futuro miente sobre la fecha del valor.
    expect(isoAll(bucketEndpoints(utc("2026-07-01"), utc("2026-08-19"), "monthly"))).toEqual([
      "2026-07-31",
      "2026-08-19",
    ]);
  });

  it("con un rango dentro de un mismo mes devuelve solo `to`", () => {
    expect(isoAll(bucketEndpoints(utc("2026-08-05"), utc("2026-08-19"), "monthly"))).toEqual([
      "2026-08-19",
    ]);
  });
});

describe("bucketEndpoints — invariantes comunes", () => {
  const granularities: Granularity[] = ["daily", "weekly", "monthly"];

  it("devuelve vacío si el rango está invertido", () => {
    for (const granularity of granularities) {
      expect(bucketEndpoints(utc("2026-05-10"), utc("2026-05-09"), granularity)).toEqual([]);
    }
  });

  it("siempre termina exactamente en `to`", () => {
    for (const granularity of granularities) {
      const points = bucketEndpoints(utc("2025-10-27"), utc("2026-08-19"), granularity);
      expect(iso(points.at(-1)!)).toBe("2026-08-19");
    }
  });

  it("devuelve fechas estrictamente crecientes y a medianoche UTC", () => {
    for (const granularity of granularities) {
      const points = bucketEndpoints(utc("2025-10-27"), utc("2026-08-19"), granularity);
      expect(points.length).toBeGreaterThan(0);
      for (const point of points) {
        expect(point.toISOString()).toMatch(/T00:00:00\.000Z$/);
      }
      for (let i = 1; i < points.length; i++) {
        expect(points[i]!.getTime()).toBeGreaterThan(points[i - 1]!.getTime());
      }
    }
  });

  it("nunca devuelve una fecha fuera del rango", () => {
    for (const granularity of granularities) {
      const from = utc("2026-02-03");
      const to = utc("2026-04-15");
      for (const point of bucketEndpoints(from, to, granularity)) {
        expect(point.getTime()).toBeGreaterThanOrEqual(from.getTime());
        expect(point.getTime()).toBeLessThanOrEqual(to.getTime());
      }
    }
  });

  it("granularidades más gruesas producen menos o igual cantidad de puntos", () => {
    const from = utc("2025-10-27");
    const to = utc("2026-08-19");
    const daily = bucketEndpoints(from, to, "daily").length;
    const weekly = bucketEndpoints(from, to, "weekly").length;
    const monthly = bucketEndpoints(from, to, "monthly").length;
    expect(daily).toBeGreaterThan(weekly);
    expect(weekly).toBeGreaterThan(monthly);
  });
});

describe("bucketByLastDay — días salteados (ruedas)", () => {
  // Lunes a viernes de dos semanas: sin sábados ni domingos, como una serie EOD real.
  const tradingDays = [
    "2026-01-05",
    "2026-01-06",
    "2026-01-07",
    "2026-01-08",
    "2026-01-09",
    "2026-01-12",
    "2026-01-13",
    "2026-01-14",
    "2026-01-15",
    "2026-01-16",
  ].map(utc);

  it("cierra cada semana en su última rueda, no en el domingo", () => {
    // Es la razón de existir de la función: valuar el domingo obligaría a arrastrar el
    // precio del viernes y marcaría el bucket como incompleto sin que falte nada.
    expect(isoAll(bucketByLastDay(tradingDays, "weekly"))).toEqual([
      "2026-01-09",
      "2026-01-16",
    ]);
  });

  it("cierra el mes en la última rueda disponible", () => {
    expect(isoAll(bucketByLastDay(tradingDays, "monthly"))).toEqual(["2026-01-16"]);
  });

  it("en diario devuelve las ruedas tal cual, sin rellenar los huecos", () => {
    expect(isoAll(bucketByLastDay(tradingDays, "daily"))).toEqual(isoAll(tradingDays));
  });

  it("agrupa por mes calendario, no por bloques de 30 días", () => {
    const acrossMonths = ["2026-01-30", "2026-02-02", "2026-02-27", "2026-03-02"].map(utc);
    expect(isoAll(bucketByLastDay(acrossMonths, "monthly"))).toEqual([
      "2026-01-30",
      "2026-02-27",
      "2026-03-02",
    ]);
  });

  it("agrupa por semana ISO aunque la semana cruce el fin de mes", () => {
    // 2026-01-26 (lun) a 2026-01-30 (vie) y 2026-02-02 (lun): semanas distintas.
    const acrossMonthBoundary = ["2026-01-26", "2026-01-30", "2026-02-02"].map(utc);
    expect(isoAll(bucketByLastDay(acrossMonthBoundary, "weekly"))).toEqual([
      "2026-01-30",
      "2026-02-02",
    ]);
  });

  it("devuelve vacío sin días", () => {
    for (const granularity of ["daily", "weekly", "monthly"] as Granularity[]) {
      expect(bucketByLastDay([], granularity)).toEqual([]);
    }
  });

  it("siempre conserva el último día recibido", () => {
    for (const granularity of ["daily", "weekly", "monthly"] as Granularity[]) {
      const buckets = bucketByLastDay(tradingDays, granularity);
      expect(iso(buckets.at(-1)!)).toBe("2026-01-16");
    }
  });

  it("devuelve fechas crecientes", () => {
    for (const granularity of ["daily", "weekly", "monthly"] as Granularity[]) {
      const buckets = bucketByLastDay(tradingDays, granularity);
      for (let i = 1; i < buckets.length; i++) {
        expect(buckets[i]!.getTime()).toBeGreaterThan(buckets[i - 1]!.getTime());
      }
    }
  });
});
