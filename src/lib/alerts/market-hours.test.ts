import { describe, expect, it } from "vitest";
import { marketsOpenAt } from "./market-hours";

// Buenos Aires es UTC-3 todo el año; Nueva York es UTC-4 en verano (EDT) y UTC-5 en
// invierno (EST). Las fechas elegidas cubren ambos lados del cambio de horario.
describe("marketsOpenAt", () => {
  it("fin de semana: todo cerrado", () => {
    // sábado 2026-10-24 15:00 UTC
    expect(marketsOpenAt(new Date("2026-10-24T15:00:00Z"))).toEqual({ byma: false, us: false, anyOpen: false });
    // domingo 2026-10-25 18:00 UTC
    expect(marketsOpenAt(new Date("2026-10-25T18:00:00Z")).anyOpen).toBe(false);
  });

  it("BYMA abre 11:00 y cierra 17:00 (hora de Buenos Aires)", () => {
    // lunes 2026-10-26: 10:59 BA = 13:59Z, 11:00 BA = 14:00Z, 16:59 BA = 19:59Z, 17:00 BA = 20:00Z
    expect(marketsOpenAt(new Date("2026-10-26T13:59:00Z")).byma).toBe(false);
    expect(marketsOpenAt(new Date("2026-10-26T14:00:00Z")).byma).toBe(true);
    expect(marketsOpenAt(new Date("2026-10-26T19:59:00Z")).byma).toBe(true);
    expect(marketsOpenAt(new Date("2026-10-26T20:00:00Z")).byma).toBe(false);
  });

  it("EE.UU. abre 9:30 y cierra 16:00 (hora de Nueva York, con horario de verano)", () => {
    // lunes 2026-10-26 (EDT, UTC-4): 9:29 = 13:29Z, 9:30 = 13:30Z, 15:59 = 19:59Z, 16:00 = 20:00Z
    expect(marketsOpenAt(new Date("2026-10-26T13:29:00Z")).us).toBe(false);
    expect(marketsOpenAt(new Date("2026-10-26T13:30:00Z")).us).toBe(true);
    expect(marketsOpenAt(new Date("2026-10-26T19:59:00Z")).us).toBe(true);
    expect(marketsOpenAt(new Date("2026-10-26T20:00:00Z")).us).toBe(false);
  });

  it("EE.UU. usa UTC-5 en invierno (EST)", () => {
    // lunes 2026-11-09 (EST, UTC-5): 9:30 = 14:30Z, 16:00 = 21:00Z
    expect(marketsOpenAt(new Date("2026-11-09T14:29:00Z")).us).toBe(false);
    expect(marketsOpenAt(new Date("2026-11-09T14:30:00Z")).us).toBe(true);
    expect(marketsOpenAt(new Date("2026-11-09T20:59:00Z")).us).toBe(true);
    expect(marketsOpenAt(new Date("2026-11-09T21:00:00Z")).us).toBe(false);
  });

  it("anyOpen es verdadero si cualquiera de los dos mercados está abierto", () => {
    // 2026-10-26 20:30Z: BYMA cerrado (17:30 BA), EE.UU. cerrado (16:30 NY)
    expect(marketsOpenAt(new Date("2026-10-26T20:30:00Z")).anyOpen).toBe(false);
    // 2026-10-26 15:00Z: ambos abiertos
    expect(marketsOpenAt(new Date("2026-10-26T15:00:00Z"))).toEqual({ byma: true, us: true, anyOpen: true });
    // 2026-10-26 13:45Z: solo EE.UU. (9:45 NY); BYMA aún no (10:45 BA)
    expect(marketsOpenAt(new Date("2026-10-26T13:45:00Z"))).toEqual({ byma: false, us: true, anyOpen: true });
  });

  it("el día de la semana se evalúa en la zona de cada mercado", () => {
    // viernes 2026-10-23 23:30Z = 20:30 BA (viernes), 19:30 NY (viernes) → cerrado igual
    // lunes 2026-10-26 02:00Z = domingo 23:00 BA / domingo 22:00 NY → cerrado
    expect(marketsOpenAt(new Date("2026-10-26T02:00:00Z")).anyOpen).toBe(false);
  });
});
