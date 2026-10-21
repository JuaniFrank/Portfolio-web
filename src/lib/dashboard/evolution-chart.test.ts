import { describe, expect, it } from "vitest";
import {
  estimatedPricesCutoff,
  formatAxisValue,
  formatDayMonth,
  round2,
} from "./evolution-chart";

const point = (date: string, hasEstimatedPrices: boolean) => ({ date, hasEstimatedPrices });

describe("estimatedPricesCutoff", () => {
  it("returns null when no point used an estimated price", () => {
    expect(estimatedPricesCutoff([point("2024-01-01", false), point("2024-01-02", false)])).toBeNull();
  });

  it("returns the first date after the last estimated point", () => {
    expect(
      estimatedPricesCutoff([
        point("2024-01-01", true),
        point("2024-01-02", true),
        point("2024-01-03", false),
        point("2024-01-04", false),
      ])
    ).toBe("2024-01-03");
  });

  it("returns null while the latest point is still estimated", () => {
    expect(estimatedPricesCutoff([point("2024-01-01", false), point("2024-01-02", true)])).toBeNull();
  });
});

describe("formatAxisValue", () => {
  it("formats percent mode as signed percentage points", () => {
    expect(formatAxisValue(1.5, "ARS", "percent")).toBe("+1,5%");
    expect(formatAxisValue(-2.25, "ARS", "percent")).toBe("-2,3%");
  });

  it("prefixes money modes with the currency symbol", () => {
    expect(formatAxisValue(4_000_000, "ARS", "value")).toMatch(/^\$/);
    expect(formatAxisValue(4_000_000, "USD", "result")).toMatch(/^U\$S /);
  });
});

describe("formatDayMonth", () => {
  it("formats a YYYY-MM-DD date as day/month in UTC (es-AR does not zero-pad)", () => {
    expect(formatDayMonth("2024-03-05")).toBe("5/3");
  });
});

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(1.006)).toBe(1.01);
    expect(round2(10.126)).toBe(10.13);
  });
});
