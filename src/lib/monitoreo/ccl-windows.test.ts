import { describe, expect, it } from "vitest";
import { selectPointsInWindows, tradeQueryBounds } from "./ccl-windows";

const p = (date: string, rate = 1) => ({ date, rate });

describe("monitoreo/ccl-windows", () => {
  describe("tradeQueryBounds", () => {
    it("returns null without trade dates", () => {
      expect(tradeQueryBounds([], 7)).toBeNull();
    });

    it("spans [min - window, max]", () => {
      expect(tradeQueryBounds(["2026-03-10", "2026-01-15", "2026-02-01"], 7)).toEqual({
        from: "2026-01-08",
        to: "2026-03-10",
      });
    });
  });

  describe("selectPointsInWindows", () => {
    const points = [
      p("2026-01-01"),
      p("2026-01-05"),
      p("2026-01-10"),
      p("2026-01-20"),
      p("2026-02-01"),
      p("2026-02-05"),
      p("2026-03-01"),
    ];

    it("keeps points inside [tradeDate - window, tradeDate] (inclusive)", () => {
      expect(selectPointsInWindows(points, ["2026-01-10"], 7).map((x) => x.date)).toEqual([
        "2026-01-05",
        "2026-01-10",
      ]);
    });

    it("drops points after the trade date and before the window", () => {
      expect(selectPointsInWindows(points, ["2026-01-04"], 7).map((x) => x.date)).toEqual([
        "2026-01-01",
      ]);
    });

    it("merges overlapping windows without duplicating points", () => {
      const out = selectPointsInWindows(points, ["2026-01-10", "2026-01-12"], 7);
      expect(out.map((x) => x.date)).toEqual(["2026-01-05", "2026-01-10"]);
    });

    it("handles several disjoint windows and unsorted/duplicated trade dates", () => {
      const out = selectPointsInWindows(points, ["2026-02-05", "2026-01-10", "2026-02-05"], 7);
      expect(out.map((x) => x.date)).toEqual(["2026-01-05", "2026-01-10", "2026-02-01", "2026-02-05"]);
    });

    it("returns nothing when no trade dates", () => {
      expect(selectPointsInWindows(points, [], 7)).toEqual([]);
    });
  });
});
