import { describe, expect, it } from "vitest";
import { DEFAULT_MARKET_TIME_ZONE, isTradingWeekday, marketDayOf } from "./market-day";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("marketDayOf", () => {
  it("usa el calendario de Argentina por defecto", () => {
    expect(DEFAULT_MARKET_TIME_ZONE).toBe("America/Argentina/Buenos_Aires");
  });

  it("devuelve el día de Argentina aunque en UTC ya sea el día siguiente", () => {
    // Lunes 22:00 en Buenos Aires = martes 01:00 UTC.
    expect(marketDayOf(new Date("2026-09-23T01:00:00.000Z"))).toEqual(utc("2026-09-22"));
  });

  it("devuelve el mismo día cuando UTC y Argentina coinciden", () => {
    expect(marketDayOf(new Date("2026-09-22T18:00:00.000Z"))).toEqual(utc("2026-09-22"));
  });

  it("acepta otra zona horaria de mercado", () => {
    // Martes 03:00 UTC: en Nueva York todavía es lunes, en Tokio ya es martes.
    const instant = new Date("2026-09-23T03:00:00.000Z");
    expect(marketDayOf(instant, "America/New_York")).toEqual(utc("2026-09-22"));
    expect(marketDayOf(instant, "Asia/Tokyo")).toEqual(utc("2026-09-23"));
  });
});

describe("isTradingWeekday", () => {
  it("acepta de lunes a viernes", () => {
    expect(isTradingWeekday(utc("2026-09-21"))).toBe(true); // lunes
    expect(isTradingWeekday(utc("2026-09-25"))).toBe(true); // viernes
  });

  it("rechaza sábado y domingo", () => {
    expect(isTradingWeekday(utc("2026-09-26"))).toBe(false);
    expect(isTradingWeekday(utc("2026-09-27"))).toBe(false);
  });
});
