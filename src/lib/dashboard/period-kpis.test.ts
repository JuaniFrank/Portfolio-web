import { describe, expect, it } from "vitest";
import type { EvolutionInstrument, EvolutionPoint, EvolutionPositionBreakdown } from "./evolution";
import { buildPeriodKpis } from "./period-kpis";

function instrument(ticker: string): EvolutionInstrument {
  return { ticker, name: `${ticker} Inc.`, type: "CEDEAR" };
}

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

/** Punto mínimo: solo llena lo que `buildViewRows`/`summarizeRange` consumen. */
function point(date: string, positions: EvolutionPositionBreakdown[]): EvolutionPoint {
  const valueArs = positions.reduce((sum, p) => sum + p.valueArs + p.incomeArs, 0);
  const valueUsd = positions.reduce((sum, p) => sum + p.valueUsd + p.incomeUsd, 0);
  return {
    date,
    valueArs,
    valueUsd,
    changeArs: 0,
    changeUsd: 0,
    returnPercent: null,
    returnPercentUsd: null,
    netFlowArs: positions.reduce((sum, p) => sum + p.netFlowArs, 0),
    netFlowUsd: positions.reduce((sum, p) => sum + p.netFlowUsd, 0),
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
  };
}

const GGAL = [instrument("GGAL")];

describe("buildPeriodKpis — Hoy", () => {
  it("compara el último punto contra el anterior", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2026-01-02", [position("GGAL", { valueArs: 1050 })]),
    ];

    const [today] = buildPeriodKpis(points, GGAL, "ARS");

    expect(today!.id).toBe("today");
    expect(today!.available).toBe(true);
    expect(today!.from).toBe("2026-01-01");
    expect(today!.to).toBe("2026-01-02");
    expect(today!.change).toBe(50);
    expect(today!.returnPercent).toBeCloseTo(5, 4);
    expect(today!.netContributions).toBe(0);
  });

  it("etiqueta 'Hoy' cuando el último punto es el overlay en vivo", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      { ...point("2026-01-02", [position("GGAL", { valueArs: 1050 })]), isLive: true },
    ];

    const [today] = buildPeriodKpis(points, GGAL, "ARS");

    expect(today!.label).toBe("Hoy");
  });

  it("etiqueta 'Última rueda DD/MM' cuando el último punto es un cierre real (no en vivo)", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2026-01-02", [position("GGAL", { valueArs: 1000 })]),
    ];

    const [today] = buildPeriodKpis(points, GGAL, "ARS");

    expect(today!.label).toBe("Última rueda 02/01");
  });

  it("también etiqueta 'Última rueda DD/MM' en una serie de un solo punto sin overlay en vivo (no disponible)", () => {
    const points = [point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })])];

    const [today] = buildPeriodKpis(points, GGAL, "ARS");

    expect(today!.available).toBe(false);
    expect(today!.label).toBe("Última rueda 01/01");
  });

  it("los aportes no cuentan como ganancia", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2026-01-02", [position("GGAL", { valueArs: 1500, netFlowArs: 500 })]),
    ];

    const [today] = buildPeriodKpis(points, GGAL, "ARS");

    expect(today!.change).toBe(0);
    expect(today!.returnPercent).toBe(0);
    expect(today!.netContributions).toBe(500);
  });

  it("serie de un solo punto: Hoy no está disponible", () => {
    const points = [point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })])];

    const kpis = buildPeriodKpis(points, GGAL, "ARS");

    expect(kpis.find((k) => k.id === "today")!.available).toBe(false);
    // Tampoco hay ventana anterior para ningún otro período.
    expect(kpis.every((k) => k.available === false)).toBe(true);
  });
});

describe("buildPeriodKpis — 7D/30D", () => {
  it("con histórico suficiente, usa exactamente 7 días atrás y no es parcial", () => {
    // 10 cierres consecutivos, sin aportes después del primero: value sube 10 por día.
    const points = Array.from({ length: 10 }, (_, i) =>
      point(`2026-01-${String(i + 1).padStart(2, "0")}`, [
        position("GGAL", i === 0 ? { valueArs: 1000, netFlowArs: 1000 } : { valueArs: 1000 + i * 10 }),
      ])
    );

    const kpis = buildPeriodKpis(points, GGAL, "ARS");
    const sevenDay = kpis.find((k) => k.id === "7d")!;

    // cutoff = 2026-01-10 - 7d = 2026-01-03 → punto de partida es ese cierre (value 1020).
    expect(sevenDay.from).toBe("2026-01-03");
    expect(sevenDay.to).toBe("2026-01-10");
    expect(sevenDay.startValue).toBe(1020);
    expect(sevenDay.endValue).toBe(1090);
    expect(sevenDay.change).toBe(70);
    expect(sevenDay.returnPercent).toBeCloseTo((1090 / 1020 - 1) * 100, 2);
    expect(sevenDay.partial).toBe(false);
  });

  it("con histórico corto, usa el primer punto disponible y marca partial", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2026-01-02", [position("GGAL", { valueArs: 1010 })]),
      point("2026-01-03", [position("GGAL", { valueArs: 1020 })]),
    ];

    const kpis = buildPeriodKpis(points, GGAL, "ARS");
    const sevenDay = kpis.find((k) => k.id === "7d")!;

    expect(sevenDay.available).toBe(true);
    expect(sevenDay.partial).toBe(true);
    expect(sevenDay.from).toBe("2026-01-01");
    expect(sevenDay.startValue).toBe(1000);
    expect(sevenDay.endValue).toBe(1020);
    expect(sevenDay.change).toBe(20);
  });
});

describe("buildPeriodKpis — moneda", () => {
  it("ARS y USD miden ventanas independientes (CCL puede moverse distinto)", () => {
    const points = [
      point("2026-01-01", [
        position("GGAL", { valueArs: 1000, valueUsd: 10, netFlowArs: 1000, netFlowUsd: 10 }),
      ]),
      point("2026-01-02", [position("GGAL", { valueArs: 1100, valueUsd: 10.5 })]),
    ];

    const todayArs = buildPeriodKpis(points, GGAL, "ARS")[0]!;
    const todayUsd = buildPeriodKpis(points, GGAL, "USD")[0]!;

    expect(todayArs.change).toBe(100);
    expect(todayArs.returnPercent).toBeCloseTo(10, 4);
    expect(todayUsd.change).toBe(0.5);
    expect(todayUsd.returnPercent).toBeCloseTo(5, 4);
  });
});

describe("buildPeriodKpis — YTD", () => {
  it("cruza el límite de año usando el último cierre del año anterior", () => {
    const points = [
      point("2025-11-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2025-12-31", [position("GGAL", { valueArs: 1100 })]),
      point("2026-01-15", [position("GGAL", { valueArs: 1200, netFlowArs: 50 })]),
    ];

    const ytd = buildPeriodKpis(points, GGAL, "ARS").find((k) => k.id === "ytd")!;

    expect(ytd.from).toBe("2025-12-31");
    expect(ytd.to).toBe("2026-01-15");
    expect(ytd.startValue).toBe(1100);
    expect(ytd.endValue).toBe(1200);
    expect(ytd.netContributions).toBe(50);
    expect(ytd.change).toBe(50);
    expect(ytd.returnPercent).toBeCloseTo((50 / 1100) * 100, 4);
    expect(ytd.partial).toBe(false);
  });

  it("sin histórico del año anterior, usa el primer punto y marca partial", () => {
    const points = [
      point("2026-01-05", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2026-01-20", [position("GGAL", { valueArs: 1050 })]),
    ];

    const ytd = buildPeriodKpis(points, GGAL, "ARS").find((k) => k.id === "ytd")!;

    expect(ytd.partial).toBe(true);
    expect(ytd.from).toBe("2026-01-05");
    expect(ytd.change).toBe(50);
  });
});
