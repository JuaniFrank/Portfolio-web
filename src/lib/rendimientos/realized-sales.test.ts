import { describe, expect, it } from "vitest";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import {
  buildRealizedSales,
  realizedFigures,
  salesInMonths,
  totalRealizedPnl,
  type RealizedSale,
} from "./realized-sales";

const GGAL = "inst-ggal";

function trade(
  type: "BUY" | "SELL",
  day: string,
  quantity: number,
  price: number,
  overrides: Partial<TradeForHoldings> = {}
): TradeForHoldings {
  return {
    instrumentId: GGAL,
    ticker: "GGAL",
    instrumentType: "STOCK_AR",
    instrumentName: "Grupo Galicia",
    type,
    quantity: String(quantity),
    price: String(price),
    netAmount: String(quantity * price),
    tradeDate: `${day}T12:00:00.000Z`,
    ...overrides,
  };
}

/** CCL fijo por día (YYYY-MM-DD); los días sin dato devuelven null. */
function cclFrom(byDay: Record<string, number>) {
  return (date: Date) => byDay[date.toISOString().slice(0, 10)] ?? null;
}

const noCcl = cclFrom({});

describe("buildRealizedSales", () => {
  it("venta total: realizado contra el costo promedio", () => {
    const sales = buildRealizedSales(
      [trade("BUY", "2026-01-10", 10, 100), trade("SELL", "2026-03-10", 10, 150)],
      new Map(),
      noCcl
    );

    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      instrumentId: GGAL,
      ticker: "GGAL",
      instrumentName: "Grupo Galicia",
      quantity: 10,
      price: 150,
      proceedsArs: 1500,
      avgCostArs: 100,
      costArs: 1000,
      realizedPnlArs: 500,
      realizedReturnPct: 50,
    });
    expect(sales[0]!.tradeDate).toBe("2026-03-10T12:00:00.000Z");
  });

  it("venta parcial: solo realiza la porción vendida y deja el costo promedio", () => {
    const sales = buildRealizedSales(
      [trade("BUY", "2026-01-10", 10, 100), trade("SELL", "2026-03-10", 4, 90)],
      new Map(),
      noCcl
    );

    expect(sales[0]).toMatchObject({
      quantity: 4,
      proceedsArs: 360,
      avgCostArs: 100,
      costArs: 400,
      realizedPnlArs: -40,
      realizedReturnPct: -10,
    });
  });

  it("varias compras a distinto precio: usa el promedio ponderado, no FIFO", () => {
    const sales = buildRealizedSales(
      [
        trade("BUY", "2026-01-10", 10, 100),
        trade("BUY", "2026-02-10", 10, 200),
        trade("SELL", "2026-03-10", 5, 300),
      ],
      new Map(),
      noCcl
    );

    // PPC = (1000 + 2000) / 20 = 150; FIFO diría 100.
    expect(sales[0]).toMatchObject({
      avgCostArs: 150,
      costArs: 750,
      proceedsArs: 1500,
      realizedPnlArs: 750,
      realizedReturnPct: 100,
    });
  });

  it("una segunda venta usa el costo ya liberado por la primera", () => {
    const sales = buildRealizedSales(
      [
        trade("BUY", "2026-01-10", 10, 100),
        trade("BUY", "2026-02-10", 10, 200),
        trade("SELL", "2026-03-10", 10, 150),
        trade("SELL", "2026-04-10", 10, 150),
      ],
      new Map(),
      noCcl
    );

    expect(sales).toHaveLength(2);
    // Tras la primera quedan 10 u a costo 1500 → el promedio sigue en 150.
    expect(sales[0]!.realizedPnlArs).toBe(0);
    expect(sales[1]).toMatchObject({ avgCostArs: 150, costArs: 1500, realizedPnlArs: 0 });
  });

  it("venta posterior a un split: el costo se ajusta por el evento, el precio mostrado no", () => {
    // 10 u a 1000 antes de un split 2:1 (efectivo 2026-02-01) → 20 u a 500 post-split.
    const events = new Map<string, CorporateEventForBuilder[]>([
      [
        GGAL,
        [
          {
            instrumentId: GGAL,
            eventType: "STOCK_SPLIT",
            effectiveDate: "2026-02-01",
            numerator: "2",
            denominator: "1",
          },
        ],
      ],
    ]);

    const sales = buildRealizedSales(
      [trade("BUY", "2026-01-10", 10, 1000), trade("SELL", "2026-03-10", 5, 600)],
      events,
      noCcl
    );

    // Costo promedio post-split = 10000 / 20 = 500 por unidad nueva; 5 u nuevas cuestan 2500.
    expect(sales[0]).toMatchObject({
      quantity: 5,
      price: 600,
      proceedsArs: 3000,
      costArs: 2500,
      avgCostArs: 500,
      realizedPnlArs: 500,
    });
  });

  it("USD: costo al CCL de cada compra y producido al CCL del día de la venta", () => {
    const ccl = cclFrom({ "2026-01-10": 1000, "2026-03-10": 1500 });

    const [sale] = buildRealizedSales(
      [trade("BUY", "2026-01-10", 10, 100), trade("SELL", "2026-03-10", 10, 150)],
      new Map(),
      ccl
    );

    expect(sale!.costUsd).toBeCloseTo(1, 6); // 1000 ARS / 1000
    expect(sale!.proceedsUsd).toBeCloseTo(1, 6); // 1500 ARS / 1500
    expect(sale!.realizedPnlUsd).toBeCloseTo(0, 6); // +50 % en pesos, 0 % en dólares
    expect(sale!.realizedReturnPctUsd).toBeCloseTo(0, 6);
  });

  it("USD: sin CCL en alguna compra o en la venta, todo el bloque USD es null", () => {
    const missingBuy = buildRealizedSales(
      [trade("BUY", "2026-01-10", 10, 100), trade("SELL", "2026-03-10", 10, 150)],
      new Map(),
      cclFrom({ "2026-03-10": 1500 })
    )[0]!;
    const missingSale = buildRealizedSales(
      [trade("BUY", "2026-01-10", 10, 100), trade("SELL", "2026-03-10", 10, 150)],
      new Map(),
      cclFrom({ "2026-01-10": 1000 })
    )[0]!;

    for (const sale of [missingBuy, missingSale]) {
      expect(sale.proceedsUsd).toBeNull();
      expect(sale.costUsd).toBeNull();
      expect(sale.realizedPnlUsd).toBeNull();
      expect(sale.realizedReturnPctUsd).toBeNull();
    }
  });

  it("días de tenencia: desde la compra que abrió la posición vigente", () => {
    const sales = buildRealizedSales(
      [
        trade("BUY", "2026-01-01", 10, 100),
        trade("SELL", "2026-01-11", 10, 100), // cierra: 10 días
        trade("BUY", "2026-02-01", 10, 100), // reabre
        trade("BUY", "2026-02-15", 10, 100), // no cambia la apertura
        trade("SELL", "2026-03-03", 5, 100), // 30 días desde el 1/2
      ],
      new Map(),
      noCcl
    );

    expect(sales.map((s) => s.holdingDays)).toEqual([10, 30]);
  });

  it("separa instrumentos y devuelve las ventas ordenadas por fecha ascendente", () => {
    const OTHER = "inst-ypf";
    const sales = buildRealizedSales(
      [
        trade("BUY", "2026-01-01", 10, 100),
        trade("BUY", "2026-01-02", 10, 10, { instrumentId: OTHER, ticker: "YPFD" }),
        trade("SELL", "2026-03-01", 10, 20, { instrumentId: OTHER, ticker: "YPFD" }),
        trade("SELL", "2026-02-01", 10, 110),
      ].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)),
      new Map(),
      noCcl
    );

    expect(sales.map((s) => s.ticker)).toEqual(["GGAL", "YPFD"]);
    expect(sales[1]!.realizedPnlArs).toBe(100); // YPFD: 200 − 100, sin mezclar costo de GGAL
  });

  it("sin compras previas no hay costo contra el cual medir: se omite la venta", () => {
    const sales = buildRealizedSales([trade("SELL", "2026-03-10", 10, 150)], new Map(), noCcl);

    expect(sales).toEqual([]);
  });

  it("no hay ventas si solo hubo compras", () => {
    expect(buildRealizedSales([trade("BUY", "2026-01-10", 10, 100)], new Map(), noCcl)).toEqual([]);
  });
});

function sale(overrides: Partial<RealizedSale> = {}): RealizedSale {
  return {
    tradeDate: "2026-03-10T12:00:00.000Z",
    instrumentId: GGAL,
    ticker: "GGAL",
    instrumentName: "Grupo Galicia",
    quantity: 10,
    price: 150,
    proceedsArs: 1500,
    avgCostArs: 100,
    costArs: 1000,
    realizedPnlArs: 500,
    realizedReturnPct: 50,
    proceedsUsd: 1,
    costUsd: 0.8,
    realizedPnlUsd: 0.2,
    realizedReturnPctUsd: 25,
    holdingDays: 30,
    ...overrides,
  };
}

describe("salesInMonths", () => {
  it("deja solo las ventas de los meses visibles, la más reciente primero", () => {
    const sales = [
      sale({ tradeDate: "2026-01-05T12:00:00.000Z", ticker: "A" }),
      sale({ tradeDate: "2026-03-05T12:00:00.000Z", ticker: "B" }),
      sale({ tradeDate: "2026-02-20T12:00:00.000Z", ticker: "C" }),
      sale({ tradeDate: "2026-04-01T12:00:00.000Z", ticker: "D" }),
    ];

    const result = salesInMonths(sales, [{ month: "2026-02" }, { month: "2026-03" }]);

    expect(result.map((s) => s.ticker)).toEqual(["B", "C"]);
  });

  it("sin meses visibles no devuelve ventas", () => {
    expect(salesInMonths([sale()], [])).toEqual([]);
  });
});

describe("realizedFigures", () => {
  it("en pesos devuelve las cifras tal cual", () => {
    expect(realizedFigures(sale(), "ARS")).toEqual({
      proceeds: 1500,
      avgCost: 100,
      cost: 1000,
      pnl: 500,
      returnPct: 50,
    });
  });

  it("en dólares usa el bloque USD y el costo promedio por unidad en dólares", () => {
    expect(realizedFigures(sale(), "USD")).toEqual({
      proceeds: 1,
      avgCost: 0.08,
      cost: 0.8,
      pnl: 0.2,
      returnPct: 25,
    });
  });

  it("en dólares sin CCL todo queda en null, no en cero", () => {
    const figures = realizedFigures(
      sale({
        proceedsUsd: null,
        costUsd: null,
        realizedPnlUsd: null,
        realizedReturnPctUsd: null,
      }),
      "USD"
    );

    expect(figures).toEqual({
      proceeds: null,
      avgCost: null,
      cost: null,
      pnl: null,
      returnPct: null,
    });
  });
});

describe("totalRealizedPnl", () => {
  it("suma el realizado de la moneda elegida", () => {
    const sales = [sale(), sale({ realizedPnlArs: -200, realizedPnlUsd: -0.1 })];

    expect(totalRealizedPnl(sales, "ARS")).toEqual({ total: 300, unmeasured: 0 });
    expect(totalRealizedPnl(sales, "USD").total).toBeCloseTo(0.1, 6);
  });

  it("cuenta aparte las ventas que no se pueden medir en dólares", () => {
    const sales = [sale(), sale({ realizedPnlUsd: null })];

    const result = totalRealizedPnl(sales, "USD");

    expect(result.total).toBeCloseTo(0.2, 6);
    expect(result.unmeasured).toBe(1);
  });

  it("sin ventas es cero", () => {
    expect(totalRealizedPnl([], "ARS")).toEqual({ total: 0, unmeasured: 0 });
  });
});
