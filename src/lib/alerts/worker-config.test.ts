import { describe, expect, it } from "vitest";
import { DEFAULT_INTERVAL_MINUTES, parseIntervalMinutes } from "./worker-config";

describe("parseIntervalMinutes", () => {
  it("usa el valor por defecto sin configuración o con basura", () => {
    for (const raw of [undefined, "", "  ", "abc", "0", "-5", "NaN", "Infinity"]) {
      expect(parseIntervalMinutes(raw)).toBe(DEFAULT_INTERVAL_MINUTES);
    }
  });

  it("acepta minutos positivos, incluso fraccionarios", () => {
    expect(parseIntervalMinutes("5")).toBe(5);
    expect(parseIntervalMinutes(" 15 ")).toBe(15);
    expect(parseIntervalMinutes("0.5")).toBe(0.5);
  });

  it("el valor por defecto es 10 minutos", () => {
    expect(DEFAULT_INTERVAL_MINUTES).toBe(10);
  });
});
