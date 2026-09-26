import { describe, expect, it } from "vitest";
import type {
  EvolutionInstrument,
  EvolutionPoint,
  EvolutionPositionBreakdown,
  EvolutionTrade,
} from "./evolution";
import {
  buildViewRows,
  rebaseForRange,
  selectTickers,
  summarizeRange,
  tradesForSelection,
} from "./evolution-view";

function instrument(
  ticker: string,
  type: EvolutionInstrument["type"] = "CEDEAR"
): EvolutionInstrument {
  return { ticker, name: `${ticker} Inc.`, type };
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

/**
 * Punto con el resto del contrato relleno con valores neutros: a este módulo solo le
 * importan `positions` y `date`, el resto es ruido de `EvolutionPoint` que no consume.
 *
 * `valueArs`/`valueUsd` replican cómo arma el agregado `valuatePortfolioAt`: holdings +
 * renta atribuida por posición + renta sin atribuir. Antes este helper sumaba solo
 * `valueArs` de las posiciones, así que un fixture con renta nunca podía distinguir "la
 * vista suma bien la renta" de "la vista ignora la renta y el agregado tampoco la tenía".
 */
function point(
  date: string,
  positions: EvolutionPositionBreakdown[],
  unattributed: { ars?: number; usd?: number } = {}
): EvolutionPoint {
  const unattributedIncomeArs = unattributed.ars ?? 0;
  const unattributedIncomeUsd = unattributed.usd ?? 0;
  const valueArs =
    positions.reduce((sum, p) => sum + p.valueArs + p.incomeArs, 0) + unattributedIncomeArs;
  const valueUsd =
    positions.reduce((sum, p) => sum + p.valueUsd + p.incomeUsd, 0) + unattributedIncomeUsd;
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
    unattributedIncomeArs,
    unattributedIncomeUsd,
  };
}

function trade(
  date: string,
  ticker: string,
  side: "buy" | "sell",
  quantity: number,
  amountArs: number,
  amountUsd: number
): EvolutionTrade {
  return { date, ticker, side, quantity, amountArs, amountUsd };
}

describe("selectTickers", () => {
  const instruments = [
    instrument("GGAL", "CEDEAR"),
    instrument("YPFD", "STOCK_AR"),
    instrument("EAC4O", "ON"),
  ];

  it("con types y tickers en 'all' devuelve todos los tickers", () => {
    const result = selectTickers(instruments, { types: "all", tickers: "all" });
    expect(result).toEqual(new Set(["GGAL", "YPFD", "EAC4O"]));
  });

  it("filtra por tipo de activo", () => {
    const result = selectTickers(instruments, {
      types: new Set(["ON"]),
      tickers: "all",
    });
    expect(result).toEqual(new Set(["EAC4O"]));
  });

  it("filtra por ticker explícito, sobre el subconjunto de tipos", () => {
    const result = selectTickers(instruments, {
      types: new Set(["CEDEAR", "STOCK_AR"]),
      tickers: new Set(["GGAL"]),
    });
    expect(result).toEqual(new Set(["GGAL"]));
  });
});

describe("buildViewRows — selección completa", () => {
  it("con todos los tickers seleccionados, value replica el agregado del punto (incluida la renta)", () => {
    // Regresión: el punto agrega renta (dividendos/cupones) al valor (ver
    // `valuatePortfolioAt`), pero `PositionDetail`/`EvolutionPositionBreakdown` solo
    // traían holdings. Con selección completa la vista tiene que sumar `valueArs +
    // incomeArs` de cada posición para igualar el agregado — sumar solo `valueArs`
    // (el bug) se queda corto exactamente por la renta.
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2026-01-02", [position("GGAL", { valueArs: 1100, incomeArs: 50 })]),
      point("2026-01-03", [
        position("GGAL", { valueArs: 600, incomeArs: 50 }),
        position("YPFD", { valueArs: 500, netFlowArs: 500, incomeArs: 20 }),
      ]),
    ];
    const selection = new Set(["GGAL", "YPFD"]);

    const rows = buildViewRows(points, selection, "ARS", true);

    expect(rows.map((r) => r.value)).toEqual(points.map((p) => p.valueArs));
  });

  it("en USD replica valueUsd (incluida la renta)", () => {
    const points = [
      point("2026-01-01", [
        position("GGAL", { valueArs: 1000, valueUsd: 2, netFlowArs: 1000, netFlowUsd: 2 }),
      ]),
      point("2026-01-02", [
        position("GGAL", { valueArs: 1100, valueUsd: 2.1, incomeArs: 50, incomeUsd: 0.1 }),
      ]),
    ];
    const rows = buildViewRows(points, new Set(["GGAL"]), "USD", true);
    expect(rows.map((r) => r.value)).toEqual(points.map((p) => p.valueUsd));
  });

  it("suma la renta sin atribuir del punto solo cuando la selección es completa", () => {
    const points = [
      point(
        "2026-01-01",
        [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })],
        { ars: 30 }
      ),
    ];

    const full = buildViewRows(points, new Set(["GGAL"]), "ARS", true);
    expect(full[0]!.value).toBe(1030);

    const partial = buildViewRows(points, new Set(["GGAL"]), "ARS", false);
    expect(partial[0]!.value).toBe(1000);
  });
});

describe("buildViewRows — filtro por ticker", () => {
  it("un solo ticker solo suma su propia posición", () => {
    const points = [
      point("2026-01-01", [
        position("GGAL", { valueArs: 1000, netFlowArs: 1000 }),
        position("YPFD", { valueArs: 500, netFlowArs: 500 }),
      ]),
      point("2026-01-02", [
        position("GGAL", { valueArs: 1200 }),
        position("YPFD", { valueArs: 480 }),
      ]),
    ];

    const rows = buildViewRows(points, new Set(["GGAL"]), "ARS", false);

    expect(rows.map((r) => r.value)).toEqual([1000, 1200]);
    expect(rows.map((r) => r.invested)).toEqual([1000, 1000]);
  });

  it("con un solo ticker seleccionado, la renta atribuida es solo la de ese ticker", () => {
    const points = [
      point("2026-01-01", [
        position("GGAL", { valueArs: 1000, netFlowArs: 1000 }),
        position("YPFD", { valueArs: 500, netFlowArs: 500 }),
      ]),
      point("2026-01-02", [
        position("GGAL", { valueArs: 1100, incomeArs: 40 }),
        position("YPFD", { valueArs: 520, incomeArs: 15 }),
      ]),
    ];

    const rows = buildViewRows(points, new Set(["GGAL"]), "ARS", false);

    // 1100 (valor) + 40 (renta de GGAL) — nunca los 15 de YPFD.
    expect(rows[1]!.value).toBe(1140);
  });

  it("la renta no cuenta como flujo: no infla `invested` ni queda fuera del resultado", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      // Sin operación en el período: el valor sube solo por la renta cobrada.
      point("2026-01-02", [position("GGAL", { valueArs: 1000, incomeArs: 50 })]),
    ];

    const rows = buildViewRows(points, new Set(["GGAL"]), "ARS", false);

    expect(rows[1]!.invested).toBe(1000);
    // value (1050) - invested (1000): la renta cuenta como resultado, no como aporte.
    expect(rows[1]!.result).toBe(50);
    expect(rows[1]!.periodReturn).toBeCloseTo(5, 4);
  });
});

describe("buildViewRows — invested (aportes acumulados)", () => {
  it("los flujos no cuentan como resultado: un aporte puro da result 0 y periodReturn nulo o cero", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      // Aporte puro: el valor sube exactamente lo que entró, sin ganancia de mercado.
      point("2026-01-02", [position("GGAL", { valueArs: 1500, netFlowArs: 500 })]),
    ];

    const rows = buildViewRows(points, new Set(["GGAL"]), "ARS", false);

    expect(rows[1]!.invested).toBe(1500);
    expect(rows[1]!.result).toBe(0);
    expect(rows[1]!.periodReturn).toBe(0);
  });

  it("acumula invested desde el primer punto de la serie completa, no se resetea al recortar", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2026-01-02", [position("GGAL", { valueArs: 1100 })]),
      point("2026-01-03", [position("GGAL", { valueArs: 1700, netFlowArs: 500 })]),
    ];

    const rows = buildViewRows(points, new Set(["GGAL"]), "ARS", false);
    // El recorte de rango es responsabilidad del caller (slice sobre `rows`); acá se
    // verifica que el tercer punto seguiría viendo el aporte del primero.
    const sliced = rows.slice(-1);
    expect(sliced[0]!.invested).toBe(1500);
  });
});

describe("buildViewRows — periodReturn", () => {
  it("primer punto de la serie: sin punto anterior, periodReturn es null", () => {
    const points = [point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })])];
    const rows = buildViewRows(points, new Set(["GGAL"]), "ARS", false);
    expect(rows[0]!.periodReturn).toBeNull();
  });

  it("valor previo cero con flujo nuevo: mide contra el flujo (posición recién abierta)", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 0 })]),
      point("2026-01-02", [position("GGAL", { valueArs: 1100, netFlowArs: 1000 })]),
    ];
    const rows = buildViewRows(points, new Set(["GGAL"]), "ARS", false);
    // ganancia = 1100 - 0 - 1000 = 100 sobre base 1000 => 10%
    expect(rows[1]!.periodReturn).toBeCloseTo(10, 4);
  });

  it("valor previo cero y sin flujo: no hay base, periodReturn null", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 0 })]),
      point("2026-01-02", [position("GGAL", { valueArs: 0 })]),
    ];
    const rows = buildViewRows(points, new Set(["GGAL"]), "ARS", false);
    expect(rows[1]!.periodReturn).toBeNull();
  });

  it("cumulativeReturn encadena los periodReturn de la serie completa", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2026-01-02", [position("GGAL", { valueArs: 1100 })]), // +10%
      point("2026-01-03", [position("GGAL", { valueArs: 1210 })]), // +10%
    ];
    const rows = buildViewRows(points, new Set(["GGAL"]), "ARS", false);
    expect(rows[0]!.cumulativeReturn).toBeNull();
    expect(rows[1]!.cumulativeReturn).toBeCloseTo(10, 4);
    expect(rows[2]!.cumulativeReturn).toBeCloseTo(21, 4);
  });
});

describe("rebaseForRange", () => {
  it("en modo % el primer punto visible arranca en 0 y encadena hacia adelante", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2026-01-02", [position("GGAL", { valueArs: 1100 })]), // +10%
      point("2026-01-03", [position("GGAL", { valueArs: 1320 })]), // +20%
      point("2026-01-04", [position("GGAL", { valueArs: 1188 })]), // -10%
    ];
    const rows = buildViewRows(points, new Set(["GGAL"]), "ARS", false);

    // El rango visible arranca en el segundo punto: el primero (con su +10%/-100%
    // inicial) queda afuera del recorte.
    const visible = rows.slice(1);
    const rebased = rebaseForRange(visible);

    expect(rebased[0]!.cumulativeReturn).toBeCloseTo(0, 6);
    expect(rebased[1]!.cumulativeReturn).toBeCloseTo(20, 4);
    expect(rebased[2]!.cumulativeReturn).toBeCloseTo(8, 4); // (1.2 * 0.9 - 1) * 100
  });

  it("no rebasa el resultado absoluto (value - invested)", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2026-01-02", [position("GGAL", { valueArs: 1100 })]),
    ];
    const rows = buildViewRows(points, new Set(["GGAL"]), "ARS", false);
    const rebased = rebaseForRange(rows.slice(1));
    expect(rebased[0]!.result).toBe(100);
  });
});

describe("summarizeRange", () => {
  it("calcula start/end/aportes/resultado/rendimiento/drawdown", () => {
    const points = [
      point("2026-01-01", [position("GGAL", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2026-01-02", [position("GGAL", { valueArs: 1300 })]), // +30%
      point("2026-01-03", [position("GGAL", { valueArs: 1040 })]), // -20% (drawdown)
      point("2026-01-04", [position("GGAL", { valueArs: 1500, netFlowArs: 300 })]),
    ];
    const rows = buildViewRows(points, new Set(["GGAL"]), "ARS", false);
    const summary = summarizeRange(rows);

    expect(summary.startValue).toBe(1000);
    expect(summary.endValue).toBe(1500);
    expect(summary.netContributions).toBe(300);
    expect(summary.result).toBe(200); // 1500 - 1000 - 300
    expect(summary.maxDrawdown).toBeLessThan(0);
    expect(summary.estimatedPrices).toBe(false);
  });

  it("marca estimatedPrices si algún punto del rango usó precio estimado", () => {
    const points = [
      point("2026-01-01", [position("EAC4O", { valueArs: 1000, netFlowArs: 1000 })]),
      point("2026-01-02", [
        position("EAC4O", { valueArs: 1050, priceEstimated: true }),
      ]),
    ];
    const rows = buildViewRows(points, new Set(["EAC4O"]), "ARS", false);
    const summary = summarizeRange(rows);
    expect(summary.estimatedPrices).toBe(true);
  });
});

describe("tradesForSelection", () => {
  const visibleDates = ["2026-01-05", "2026-01-10", "2026-01-15"];

  it("agrupa por fecha snapeada a la primera fecha visible >= la operación", () => {
    const trades = [
      trade("2026-01-03", "GGAL", "buy", 10, 1000, 1),
      trade("2026-01-07", "GGAL", "buy", 5, 500, 0.5),
    ];
    const markers = tradesForSelection(trades, "all", visibleDates, "ARS");

    // La del 03 queda afuera: es anterior a la primera fecha visible.
    expect(markers).toHaveLength(1);
    expect(markers[0]!.date).toBe("2026-01-10");
    expect(markers[0]!.side).toBe("buy");
    expect(markers[0]!.count).toBe(1);
  });

  it("mezcla compra y venta del mismo bucket en 'mixed'", () => {
    const trades = [
      trade("2026-01-09", "GGAL", "buy", 10, 1000, 1),
      trade("2026-01-10", "YPFD", "sell", 3, 300, 0.3),
    ];
    const markers = tradesForSelection(trades, "all", visibleDates, "ARS");

    expect(markers).toHaveLength(1);
    expect(markers[0]!.side).toBe("mixed");
    expect(markers[0]!.count).toBe(2);
    expect(markers[0]!.totalAmount).toBe(1300);
    expect(markers[0]!.trades).toEqual([
      { ticker: "GGAL", side: "buy", quantity: 10, amount: 1000 },
      { ticker: "YPFD", side: "sell", quantity: 3, amount: 300 },
    ]);
  });

  it("filtra por selección de tickers", () => {
    const trades = [
      trade("2026-01-09", "GGAL", "buy", 10, 1000, 1),
      trade("2026-01-09", "YPFD", "buy", 3, 300, 0.3),
    ];
    const markers = tradesForSelection(trades, new Set(["GGAL"]), visibleDates, "ARS");
    expect(markers).toHaveLength(1);
    expect(markers[0]!.trades.map((t) => t.ticker)).toEqual(["GGAL"]);
  });

  it("descarta operaciones posteriores a la última fecha visible", () => {
    const trades = [trade("2026-01-20", "GGAL", "buy", 10, 1000, 1)];
    const markers = tradesForSelection(trades, "all", visibleDates, "ARS");
    expect(markers).toHaveLength(0);
  });

  it("usa el monto en la moneda pedida", () => {
    const trades = [trade("2026-01-09", "GGAL", "buy", 10, 1000, 1.25)];
    const markers = tradesForSelection(trades, "all", visibleDates, "USD");
    expect(markers[0]!.totalAmount).toBe(1.25);
  });
});
