import { describe, expect, it } from "vitest";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import { buildRealizedSales } from "./realized-sales";
import { withRealizedOriginals, type OriginalSource } from "./realized-original";
import type { UnderlyingBar } from "./underlying-price";

const INST = "inst-1";

function trade(
  type: "BUY" | "SELL",
  day: string,
  quantity: number,
  price: number
): TradeForHoldings {
  return {
    instrumentId: INST,
    ticker: "AAPL",
    instrumentType: "CEDEAR",
    instrumentName: "Apple",
    type,
    quantity: String(quantity),
    price: String(price),
    netAmount: String(quantity * price),
    tradeDate: `${day}T12:00:00.000Z`,
  };
}

function bar(day: string, close: number): UnderlyingBar {
  return { date: new Date(`${day}T00:00:00.000Z`), close };
}

function source(overrides: Partial<OriginalSource> = {}): OriginalSource {
  return {
    basis: "USD",
    symbol: "AAPL",
    exchange: "NASDAQ",
    bars: [],
    currentPrice: null,
    ...overrides,
  };
}

const noCcl = () => null;

function run(
  trades: TradeForHoldings[],
  sources: Map<string, OriginalSource>,
  events: CorporateEventForBuilder[] = []
) {
  const eventMap = new Map(events.length ? [[INST, events]] : []);
  const sales = buildRealizedSales(trades, eventMap, noCcl);
  return withRealizedOriginals(sales, trades, eventMap, sources);
}

describe("withRealizedOriginals", () => {
  it("CEDEAR: una venta parcial conserva el promedio de la acción original", () => {
    const bars = [
      bar("2026-01-05", 100),
      bar("2026-01-12", 200),
      bar("2026-02-02", 250),
      bar("2026-02-09", 260),
    ];
    const result = run(
      [
        trade("BUY", "2026-01-05", 10, 1),
        trade("BUY", "2026-01-12", 10, 1),
        trade("SELL", "2026-02-02", 5, 1),
        trade("SELL", "2026-02-09", 5, 1),
      ],
      new Map([[INST, source({ bars, currentPrice: 300 })]])
    );

    expect(result).toHaveLength(2);
    expect(result[0]!.original).toMatchObject({ basis: "USD", symbol: "AAPL", exchange: "NASDAQ", avgCost: 150 });
    expect(result[1]!.original!.avgCost).toBe(150);
  });

  it("venta total y recompra: el promedio de la segunda venta arranca de cero", () => {
    const bars = [
      bar("2026-01-05", 100),
      bar("2026-01-20", 120),
      bar("2026-02-02", 300),
      bar("2026-02-20", 330),
    ];
    const result = run(
      [
        trade("BUY", "2026-01-05", 10, 1),
        trade("SELL", "2026-01-20", 10, 1),
        trade("BUY", "2026-02-02", 10, 1),
        trade("SELL", "2026-02-20", 10, 1),
      ],
      new Map([[INST, source({ bars })]])
    );

    expect(result.map((sale) => sale.original!.avgCost)).toEqual([100, 300]);
  });

  it("una compra sin cierre disponible deja el promedio en null, sin promedio a medias", () => {
    // La compra del 5/1 no tiene rueda en los 10 días previos.
    const bars = [bar("2025-12-01", 90), bar("2026-01-12", 200), bar("2026-02-02", 250)];
    const result = run(
      [
        trade("BUY", "2026-01-05", 10, 1),
        trade("BUY", "2026-01-12", 10, 1),
        trade("SELL", "2026-02-02", 5, 1),
      ],
      new Map([[INST, source({ bars, currentPrice: 260 })]])
    );

    expect(result[0]!.original).toMatchObject({ avgCost: null, saleDayPrice: 250 });
  });

  it("el precio del día de la venta toma la rueda anterior si cayó en fin de semana", () => {
    // 2026-02-07 es sábado.
    const bars = [bar("2026-01-05", 100), bar("2026-02-06", 240)];
    const result = run(
      [trade("BUY", "2026-01-05", 10, 1), trade("SELL", "2026-02-07", 10, 1)],
      new Map([[INST, source({ bars })]])
    );

    expect(result[0]!.original!.saleDayPrice).toBe(240);
  });

  it("acción local con split posterior a la venta: todo en unidades de hoy", () => {
    // Split 2:1 el 2026-03-01. Las ruedas ya vienen a escala post-evento (mitad de lo crudo).
    const events: CorporateEventForBuilder[] = [
      {
        instrumentId: INST,
        eventType: "STOCK_SPLIT",
        effectiveDate: "2026-03-01",
        numerator: "2",
        denominator: "1",
      },
    ];
    const bars = [bar("2026-01-05", 500), bar("2026-02-02", 600)];
    const result = run(
      [
        { ...trade("BUY", "2026-01-05", 10, 1000), instrumentType: "STOCK_AR" },
        { ...trade("SELL", "2026-02-02", 10, 1200), instrumentType: "STOCK_AR" },
      ],
      new Map([[INST, source({ basis: "ARS", symbol: "GGAL", exchange: null, bars, currentPrice: 700 })]]),
      events
    );

    expect(result[0]!.original).toMatchObject({
      basis: "ARS",
      avgCost: 500,
      saleDayPrice: 600,
      currentPrice: 700,
    });
    expect(result[0]!.original!.pctVsSale).toBeCloseTo((700 / 600 - 1) * 100, 10);
  });

  it("acción local con split previo a la venta: sin ajuste extra", () => {
    const events: CorporateEventForBuilder[] = [
      {
        instrumentId: INST,
        eventType: "STOCK_SPLIT",
        effectiveDate: "2026-01-20",
        numerator: "2",
        denominator: "1",
      },
    ];
    // La compra (5/1) es previa al split: cantidad 10 -> 20 y rueda 1000 -> 500.
    // La venta (3/2) es posterior: su rueda ya está en unidades de hoy.
    const bars = [bar("2026-01-05", 500), bar("2026-02-03", 650)];
    const result = run(
      [
        { ...trade("BUY", "2026-01-05", 10, 1000), instrumentType: "STOCK_AR" },
        { ...trade("SELL", "2026-02-03", 20, 650), instrumentType: "STOCK_AR" },
      ],
      new Map([[INST, source({ basis: "ARS", bars, currentPrice: 600 })]]),
      events
    );

    expect(result[0]!.original).toMatchObject({ avgCost: 500, saleDayPrice: 650, currentPrice: 600 });
  });

  it("un instrumento sin fuente (bono, FCI) queda con original null", () => {
    const result = run(
      [trade("BUY", "2026-01-05", 10, 1), trade("SELL", "2026-02-02", 10, 1)],
      new Map()
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.original).toBeNull();
  });

  it("marca belowSale cuando el precio actual quedó por debajo del de la venta", () => {
    const bars = [bar("2026-01-05", 100), bar("2026-02-02", 200)];
    const [sale] = run(
      [trade("BUY", "2026-01-05", 10, 1), trade("SELL", "2026-02-02", 10, 1)],
      new Map([[INST, source({ bars, currentPrice: 176 })]])
    );

    expect(sale!.original!.belowSale).toBe(true);
    expect(sale!.original!.pctVsSale).toBeCloseTo(-12, 10);
  });

  it("no marca belowSale si el precio actual es igual o mayor al de la venta", () => {
    const bars = [bar("2026-01-05", 100), bar("2026-02-02", 200)];
    const trades = [trade("BUY", "2026-01-05", 10, 1), trade("SELL", "2026-02-02", 10, 1)];

    const [equal] = run(trades, new Map([[INST, source({ bars, currentPrice: 200 })]]));
    const [above] = run(trades, new Map([[INST, source({ bars, currentPrice: 230 })]]));

    expect(equal!.original!.belowSale).toBe(false);
    expect(equal!.original!.pctVsSale).toBe(0);
    expect(above!.original!.belowSale).toBe(false);
    expect(above!.original!.pctVsSale).toBeCloseTo(15, 10);
  });

  it("sin precio actual: variación null y sin etiqueta, pero el resto se conserva", () => {
    const bars = [bar("2026-01-05", 100), bar("2026-02-02", 200)];
    const [sale] = run(
      [trade("BUY", "2026-01-05", 10, 1), trade("SELL", "2026-02-02", 10, 1)],
      new Map([[INST, source({ bars, currentPrice: null })]])
    );

    expect(sale!.original).toMatchObject({
      avgCost: 100,
      saleDayPrice: 200,
      currentPrice: null,
      pctVsSale: null,
      belowSale: false,
    });
  });

  it("sin ruedas (falló Yahoo): todo null pero se conserva moneda y símbolo", () => {
    const [sale] = run(
      [trade("BUY", "2026-01-05", 10, 1), trade("SELL", "2026-02-02", 10, 1)],
      new Map([[INST, source({ bars: null, currentPrice: 180 })]])
    );

    expect(sale!.original).toMatchObject({
      basis: "USD",
      symbol: "AAPL",
      avgCost: null,
      saleDayPrice: null,
      currentPrice: 180,
      pctVsSale: null,
      belowSale: false,
    });
  });
});
