import { describe, expect, it } from "vitest";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import type { PositionDetail } from "./types";
import { PriceIndex } from "./price-series";
import { buildPositionRows, formatHoldingAge } from "./position-rows";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const AAPL = "inst-aapl";
const GGAL = "inst-ggal";

function trade(
  instrumentId: string,
  ticker: string,
  type: "BUY" | "SELL",
  tradeDate: string,
  quantity: number
): TradeForHoldings {
  return {
    instrumentId,
    ticker,
    instrumentType: "CEDEAR",
    instrumentName: ticker,
    type,
    quantity: String(quantity),
    price: "100",
    netAmount: String(quantity * 100),
    tradeDate: `${tradeDate}T12:00:00.000Z`,
  };
}

/** Defaults de una posición ya calculada por `valuatePortfolioAt`. */
function position(overrides: Partial<PositionDetail> = {}): PositionDetail {
  return {
    instrumentId: AAPL,
    ticker: "AAPL",
    instrumentName: "Apple Inc.",
    instrumentType: "CEDEAR",
    quantity: 10,
    priceArs: 200,
    valueArs: 2000,
    valueUsd: 2,
    costBasisArs: 1000,
    unrealizedPnlArs: 1000,
    unrealizedReturnPct: 100,
    costBasisUsd: 5,
    unrealizedPnlUsd: -3,
    unrealizedReturnPctUsd: -60,
    priceIsStale: false,
    priceIsLive: false,
    ...overrides,
  };
}

describe("buildPositionRows — costo promedio", () => {
  it("divide el costo total por la cantidad para el costo promedio en ARS y USD", () => {
    const [row] = buildPositionRows(
      [position({ quantity: 10, costBasisArs: 1000, costBasisUsd: 5 })],
      [trade(AAPL, "AAPL", "BUY", "2026-01-01", 10)],
      new PriceIndex([]),
      utc("2026-01-10")
    );

    expect(row!.avgCostArs).toBe(100);
    expect(row!.avgCostUsd).toBe(0.5);
  });

  it("el costo promedio en USD es null cuando el costo en dólares no es medible", () => {
    const [row] = buildPositionRows(
      [position({ quantity: 10, costBasisUsd: null })],
      [trade(AAPL, "AAPL", "BUY", "2026-01-01", 10)],
      new PriceIndex([]),
      utc("2026-01-10")
    );

    expect(row!.avgCostUsd).toBeNull();
  });

  it("el costo promedio es null sin cantidad (posición vacía, defensivo)", () => {
    const [row] = buildPositionRows(
      [position({ quantity: 0, costBasisArs: 0, costBasisUsd: 0 })],
      [],
      new PriceIndex([]),
      utc("2026-01-10")
    );

    expect(row!.avgCostArs).toBeNull();
    expect(row!.avgCostUsd).toBeNull();
  });
});

describe("buildPositionRows — retorno", () => {
  it("pasa el retorno ARS y USD ya calculados por el motor sin recalcularlos", () => {
    const [row] = buildPositionRows(
      [
        position({
          unrealizedPnlArs: 1000,
          unrealizedReturnPct: 100,
          unrealizedPnlUsd: -3,
          unrealizedReturnPctUsd: -60,
        }),
      ],
      [],
      new PriceIndex([]),
      utc("2026-01-10")
    );

    expect(row!.returnArs).toEqual({ amount: 1000, pct: 100 });
    expect(row!.returnUsd).toEqual({ amount: -3, pct: -60 });
  });

  it("el retorno USD es null cuando el costo en dólares no es medible", () => {
    const [row] = buildPositionRows(
      [position({ unrealizedPnlUsd: null, unrealizedReturnPctUsd: null })],
      [],
      new PriceIndex([]),
      utc("2026-01-10")
    );

    expect(row!.returnUsd).toEqual({ amount: null, pct: null });
  });
});

describe("buildPositionRows — peso de cartera", () => {
  it("calcula el peso como el valor de la posición sobre el total", () => {
    const rows = buildPositionRows(
      [
        position({ instrumentId: AAPL, ticker: "AAPL", valueArs: 3000 }),
        position({ instrumentId: GGAL, ticker: "GGAL", valueArs: 1000 }),
      ],
      [],
      new PriceIndex([]),
      utc("2026-01-10")
    );

    expect(rows.find((r) => r.ticker === "AAPL")!.weightPct).toBe(75);
    expect(rows.find((r) => r.ticker === "GGAL")!.weightPct).toBe(25);
  });

  it("el peso es 0 cuando el valor total de la cartera es 0", () => {
    const [row] = buildPositionRows(
      [position({ valueArs: 0 })],
      [],
      new PriceIndex([]),
      utc("2026-01-10")
    );

    expect(row!.weightPct).toBe(0);
  });
});

describe("buildPositionRows — variación diaria", () => {
  it("compara el precio de hoy contra el cierre anterior de la serie", () => {
    const prices = new PriceIndex([
      { instrumentId: AAPL, date: utc("2026-01-09"), close: 190 },
      { instrumentId: AAPL, date: utc("2026-01-10"), close: 200 },
    ]);

    const [row] = buildPositionRows(
      [position({ priceArs: 200 })],
      [],
      prices,
      utc("2026-01-10")
    );

    expect(row!.dailyChangePct).toBeCloseTo(((200 - 190) / 190) * 100, 6);
  });

  it("es null cuando no hay cierre anterior", () => {
    const prices = new PriceIndex([
      { instrumentId: AAPL, date: utc("2026-01-10"), close: 200 },
    ]);

    const [row] = buildPositionRows(
      [position({ priceArs: 200 })],
      [],
      prices,
      utc("2026-01-10")
    );

    expect(row!.dailyChangePct).toBeNull();
  });

  it("es null cuando el instrumento no tiene serie de precios (p. ej. overlay en vivo puro)", () => {
    const [row] = buildPositionRows(
      [position({ priceArs: 200 })],
      [],
      new PriceIndex([]),
      utc("2026-01-10")
    );

    expect(row!.dailyChangePct).toBeNull();
  });
});

describe("buildPositionRows — antigüedad de la tenencia", () => {
  it("cuenta desde la primera compra cuando nunca se vendió del todo", () => {
    const [row] = buildPositionRows(
      [position({ quantity: 10 })],
      [
        trade(AAPL, "AAPL", "BUY", "2026-01-01", 5),
        trade(AAPL, "AAPL", "BUY", "2026-01-06", 5),
      ],
      new PriceIndex([]),
      utc("2026-01-11")
    );

    expect(row!.holdingDays).toBe(10);
  });

  it("reinicia el conteo después de una venta total", () => {
    const [row] = buildPositionRows(
      [position({ quantity: 5 })],
      [
        trade(AAPL, "AAPL", "BUY", "2025-01-01", 10),
        trade(AAPL, "AAPL", "SELL", "2025-06-01", 10),
        trade(AAPL, "AAPL", "BUY", "2026-01-01", 5),
      ],
      new PriceIndex([]),
      utc("2026-01-11")
    );

    expect(row!.holdingDays).toBe(10);
  });

  it("es null si no hay operaciones de compra para el instrumento (defensivo)", () => {
    const [row] = buildPositionRows(
      [position({ quantity: 10 })],
      [],
      new PriceIndex([]),
      utc("2026-01-11")
    );

    expect(row!.holdingDays).toBeNull();
  });
});

describe("buildPositionRows — marcadores de precio", () => {
  it("pasa priceIsStale y priceIsLive del motor sin tocarlos", () => {
    const [row] = buildPositionRows(
      [position({ priceIsStale: true, priceIsLive: false })],
      [],
      new PriceIndex([]),
      utc("2026-01-10")
    );
    expect(row!.priceIsStale).toBe(true);
    expect(row!.priceIsLive).toBe(false);
  });
});

describe("formatHoldingAge", () => {
  it("formatea días puros como 'Xd'", () => {
    expect(formatHoldingAge(12)).toBe("12d");
    expect(formatHoldingAge(0)).toBe("0d");
  });

  it("formatea meses como 'Xm'", () => {
    expect(formatHoldingAge(150)).toBe("5m");
  });

  it("formatea años y meses como 'Xa Ym'", () => {
    expect(formatHoldingAge(761)).toBe("2a 1m");
  });

  it("omite los meses cuando el resto es exactamente un año", () => {
    expect(formatHoldingAge(730)).toBe("2a");
  });
});
