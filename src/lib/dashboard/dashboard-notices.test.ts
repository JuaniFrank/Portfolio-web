import { describe, expect, it } from "vitest";
import type { EvolutionPoint, EvolutionPositionBreakdown } from "./evolution";
import type { ConcentrationStats } from "./types";
import { buildDashboardNotices } from "./dashboard-notices";

function position(
  ticker: string,
  overrides: Partial<EvolutionPositionBreakdown> = {}
): EvolutionPositionBreakdown {
  return {
    ticker,
    valueArs: 0,
    valueUsd: 0,
    netFlowArs: 0,
    netFlowUsd: 0,
    incomeArs: 0,
    incomeUsd: 0,
    priceEstimated: false,
    ...overrides,
  };
}

function lastPoint(overrides: Partial<EvolutionPoint> = {}): EvolutionPoint {
  const positions = overrides.positions ?? [];
  return {
    date: "2026-01-10",
    valueArs: 0,
    valueUsd: 0,
    changeArs: 0,
    changeUsd: 0,
    returnPercent: null,
    returnPercentUsd: null,
    netFlowArs: 0,
    netFlowUsd: 0,
    cumulativeNetFlowArs: 0,
    cumulativeNetFlowUsd: 0,
    coverage: "full",
    staleTickers: [],
    gainers: [],
    losers: [],
    positions,
    hasEstimatedPrices: positions.some((p) => p.priceEstimated),
    isLive: false,
    unattributedIncomeArs: 0,
    unattributedIncomeUsd: 0,
    ...overrides,
  };
}

function concentration(overrides: Partial<ConcentrationStats> = {}): ConcentrationStats {
  return {
    top5Percent: "40.00",
    topHoldingTicker: "GGAL",
    topHoldingPercent: "20.00",
    hhi: "1000",
    level: "moderada",
    oversizedPositions: [],
    ...overrides,
  };
}

describe("buildDashboardNotices", () => {
  it("no reporta nada cuando todo está en orden", () => {
    const notices = buildDashboardNotices({
      cclMissing: false,
      lastPoint: lastPoint(),
      concentration: concentration(),
    });
    expect(notices).toEqual([]);
  });

  it("avisa cuando falta el CCL", () => {
    const notices = buildDashboardNotices({
      cclMissing: true,
      lastPoint: lastPoint(),
      concentration: concentration(),
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]!.severity).toBe("warning");
    expect(notices[0]!.id).toBe("ccl-missing");
  });

  it("avisa con la lista de tickers con precio desactualizado", () => {
    const notices = buildDashboardNotices({
      cclMissing: false,
      lastPoint: lastPoint({ staleTickers: ["GGAL", "YPFD"] }),
      concentration: concentration(),
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]!.id).toBe("stale-tickers");
    expect(notices[0]!.severity).toBe("warning");
    expect(notices[0]!.detail).toContain("GGAL");
    expect(notices[0]!.detail).toContain("YPFD");
  });

  it("avisa (info) cuando el último punto usó precios estimados de ON", () => {
    const notices = buildDashboardNotices({
      cclMissing: false,
      lastPoint: lastPoint({
        positions: [position("EAC4O", { priceEstimated: true }), position("GGAL")],
      }),
      concentration: concentration(),
    });
    expect(notices).toHaveLength(1);
    expect(notices[0]!.id).toBe("estimated-on");
    expect(notices[0]!.severity).toBe("info");
    expect(notices[0]!.detail).toContain("EAC4O");
    expect(notices[0]!.detail).not.toContain("GGAL");
  });

  it("sin lastPoint (sin histórico) no rompe y omite los avisos de ese punto", () => {
    const notices = buildDashboardNotices({
      cclMissing: false,
      lastPoint: null,
      concentration: concentration(),
    });
    expect(notices).toEqual([]);
  });

  describe("concentración", () => {
    it("no avisa en el límite exacto (25.00% / 70.00%)", () => {
      const notices = buildDashboardNotices({
        cclMissing: false,
        lastPoint: lastPoint(),
        concentration: concentration({ topHoldingPercent: "25.00", top5Percent: "70.00" }),
      });
      expect(notices).toEqual([]);
    });

    it("avisa cuando la posición principal supera 25%", () => {
      const notices = buildDashboardNotices({
        cclMissing: false,
        lastPoint: lastPoint(),
        concentration: concentration({ topHoldingPercent: "25.01", topHoldingTicker: "GGAL" }),
      });
      expect(notices).toHaveLength(1);
      expect(notices[0]!.id).toBe("concentration");
      expect(notices[0]!.severity).toBe("info");
      expect(notices[0]!.detail).toContain("GGAL");
    });

    it("avisa cuando el top-5 supera 70%, aunque ninguna posición individual pase el 25%", () => {
      const notices = buildDashboardNotices({
        cclMissing: false,
        lastPoint: lastPoint(),
        concentration: concentration({ topHoldingPercent: "20.00", top5Percent: "70.01" }),
      });
      expect(notices).toHaveLength(1);
      expect(notices[0]!.id).toBe("concentration");
      expect(notices[0]!.severity).toBe("info");
    });
  });

  it("acumula todos los avisos aplicables a la vez", () => {
    const notices = buildDashboardNotices({
      cclMissing: true,
      lastPoint: lastPoint({
        staleTickers: ["YPFD"],
        positions: [position("EAC4O", { priceEstimated: true })],
      }),
      concentration: concentration({ topHoldingPercent: "30.00" }),
    });
    expect(notices.map((n) => n.id)).toEqual([
      "ccl-missing",
      "stale-tickers",
      "estimated-on",
      "concentration",
    ]);
  });
});
