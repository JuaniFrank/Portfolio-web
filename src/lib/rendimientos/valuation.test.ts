import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import { PriceIndex, TimeSeries } from "./price-series";
import { type ReplayInputs, sumUpTo, valuatePortfolioAt } from "./valuation";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const AAPL = "inst-aapl";
const GGAL = "inst-ggal";

/** Compra con `netAmount` = costo total, como lo arma `series.ts` desde Prisma. */
function buy(
  instrumentId: string,
  ticker: string,
  tradeDate: string,
  quantity: number,
  price: number
): TradeForHoldings {
  return {
    instrumentId,
    ticker,
    instrumentType: "CEDEAR",
    instrumentName: ticker,
    type: "BUY",
    quantity: String(quantity),
    price: String(price),
    netAmount: String(quantity * price),
    // Los imports guardan mediodía UTC: es justo el caso que rompe comparar instantes.
    tradeDate: `${tradeDate}T12:00:00.000Z`,
  };
}

function inputs(overrides: Partial<ReplayInputs> = {}): ReplayInputs {
  return {
    trades: [],
    prices: new PriceIndex([]),
    ccl: new TimeSeries([]),
    eventsByInstrument: new Map(),
    incomeArsByDate: [],
    ...overrides,
  };
}

describe("valuatePortfolioAt — precios as-of", () => {
  it("valúa con el precio del día, no con el último de la serie", () => {
    const result = valuatePortfolioAt(
      inputs({
        trades: [buy(AAPL, "AAPL", "2026-01-05", 10, 100)],
        prices: new PriceIndex([
          { instrumentId: AAPL, date: utc("2026-01-05"), close: 100 },
          { instrumentId: AAPL, date: utc("2026-01-10"), close: 200 },
          { instrumentId: AAPL, date: utc("2026-01-20"), close: 999 },
        ]),
      }),
      utc("2026-01-10"),
      utc("2026-01-10")
    );

    expect(result.valueArs).toBe(2000);
    expect(result.positions[0]!.priceArs).toBe(200);
    expect(result.coverage).toBe("full");
  });

  it("excluye las operaciones posteriores a la fecha de valuación", () => {
    const result = valuatePortfolioAt(
      inputs({
        trades: [
          buy(AAPL, "AAPL", "2026-01-05", 10, 100),
          buy(AAPL, "AAPL", "2026-02-05", 90, 100),
        ],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-05"), close: 100 }]),
      }),
      utc("2026-01-31"),
      utc("2026-01-01")
    );

    expect(result.positions[0]!.quantity).toBe(10);
    expect(result.valueArs).toBe(1000);
  });

  it("incluye una compra del mismo día de la valuación aunque tenga hora", () => {
    // Comparar instantes dejaría la compra (12:00) fuera de un cierre a medianoche,
    // inventando una pérdida del tamaño exacto de la compra.
    const result = valuatePortfolioAt(
      inputs({
        trades: [buy(AAPL, "AAPL", "2026-01-31", 10, 100)],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-31"), close: 110 }]),
      }),
      utc("2026-01-31"),
      utc("2026-01-01")
    );

    expect(result.positions).toHaveLength(1);
    expect(result.valueArs).toBe(1100);
  });
});

describe("valuatePortfolioAt — arrastre y cobertura", () => {
  it("marca el ticker como arrastrado cuando el precio es previo a la ventana", () => {
    const result = valuatePortfolioAt(
      inputs({
        trades: [buy(AAPL, "AAPL", "2026-01-05", 10, 100)],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-05"), close: 100 }]),
      }),
      utc("2026-03-31"),
      utc("2026-03-01")
    );

    expect(result.staleTickers).toEqual(["AAPL"]);
    expect(result.positions[0]!.priceIsStale).toBe(true);
    expect(result.coverage).toBe("partial");
  });

  it("no marca arrastre cuando el precio cae dentro de la ventana", () => {
    const result = valuatePortfolioAt(
      inputs({
        trades: [buy(AAPL, "AAPL", "2026-01-05", 10, 100)],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-03-15"), close: 150 }]),
      }),
      utc("2026-03-31"),
      utc("2026-03-01")
    );

    expect(result.staleTickers).toEqual([]);
    expect(result.coverage).toBe("full");
  });

  it("sin precio cae al PPP y lo reporta como arrastre", () => {
    const result = valuatePortfolioAt(
      inputs({ trades: [buy(AAPL, "AAPL", "2026-01-05", 10, 100)] }),
      utc("2026-01-31"),
      utc("2026-01-01")
    );

    // Valuado a costo: es una valuación, pero no una medición.
    expect(result.valueArs).toBe(1000);
    expect(result.positions[0]!.unrealizedPnlArs).toBe(0);
    expect(result.staleTickers).toEqual(["AAPL"]);
    expect(result.coverage).toBe("partial");
  });

  it("es 'partial' si un instrumento tiene precio y el otro no", () => {
    const result = valuatePortfolioAt(
      inputs({
        trades: [
          buy(AAPL, "AAPL", "2026-01-05", 10, 100),
          buy(GGAL, "GGAL", "2026-01-05", 5, 200),
        ],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-31"), close: 120 }]),
      }),
      utc("2026-01-31"),
      utc("2026-01-01")
    );

    expect(result.coverage).toBe("partial");
    expect(result.staleTickers).toEqual(["GGAL"]);
  });

  it("es 'empty' cuando todavía no hay tenencia", () => {
    const result = valuatePortfolioAt(
      inputs({ trades: [buy(AAPL, "AAPL", "2026-05-05", 10, 100)] }),
      utc("2026-01-31"),
      utc("2026-01-01")
    );

    expect(result.positions).toEqual([]);
    expect(result.valueArs).toBe(0);
    expect(result.coverage).toBe("empty");
  });
});

describe("valuatePortfolioAt — USD", () => {
  it("convierte al CCL de la fecha de valuación", () => {
    const result = valuatePortfolioAt(
      inputs({
        trades: [buy(AAPL, "AAPL", "2026-01-05", 10, 100)],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-31"), close: 100 }]),
        ccl: new TimeSeries([
          { date: utc("2026-01-01"), value: 1000 },
          { date: utc("2026-01-31"), value: 2000 },
        ]),
      }),
      utc("2026-01-31"),
      utc("2026-01-01")
    );

    expect(result.cclMid).toBe(2000);
    expect(result.valueUsd).toBe(0.5);
    expect(result.positions[0]!.valueUsd).toBe(0.5);
  });

  it("deja el valor USD en cero cuando no hay CCL", () => {
    const result = valuatePortfolioAt(
      inputs({
        trades: [buy(AAPL, "AAPL", "2026-01-05", 10, 100)],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-31"), close: 100 }]),
      }),
      utc("2026-01-31"),
      utc("2026-01-01")
    );

    expect(result.cclMid).toBeNull();
    expect(result.valueUsd).toBe(0);
  });
});

describe("valuatePortfolioAt — renta acumulada", () => {
  const withIncome = (valuationDate: string) =>
    valuatePortfolioAt(
      inputs({
        trades: [buy(AAPL, "AAPL", "2026-01-05", 10, 100)],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-05"), close: 100 }]),
        incomeArsByDate: [
          { time: utc("2026-01-20").getTime(), amount: new Decimal(500) },
          { time: utc("2026-02-20").getTime(), amount: new Decimal(300) },
        ],
      }),
      utc(valuationDate),
      utc("2026-01-01")
    );

  it("suma la renta cobrada hasta la fecha al valor del perímetro", () => {
    const result = withIncome("2026-01-31");
    expect(result.holdingsValueArs).toBe(1000);
    expect(result.accumulatedIncomeArs).toBe(500);
    expect(result.valueArs).toBe(1500);
  });

  it("no cuenta la renta posterior a la fecha de valuación", () => {
    expect(withIncome("2026-01-19").accumulatedIncomeArs).toBe(0);
  });

  it("acumula la renta de fechas anteriores", () => {
    expect(withIncome("2026-02-28").accumulatedIncomeArs).toBe(800);
  });

  it("mantiene la renta fuera de las posiciones", () => {
    // La renta es del portfolio, no de una tenencia: sumarla a una posición
    // inflaría su rendimiento individual.
    const result = withIncome("2026-01-31");
    expect(result.positions).toHaveLength(1);
    expect(result.positions[0]!.valueArs).toBe(1000);
  });
});

describe("sumUpTo", () => {
  const amounts = [
    { time: utc("2026-01-10").getTime(), amount: new Decimal(100) },
    { time: utc("2026-02-10").getTime(), amount: new Decimal(50) },
  ];

  it("incluye el corte exacto", () => {
    expect(sumUpTo(amounts, utc("2026-01-10").getTime()).toNumber()).toBe(100);
  });

  it("devuelve cero antes del primer evento", () => {
    expect(sumUpTo(amounts, utc("2026-01-01").getTime()).toNumber()).toBe(0);
  });

  it("acumula todo lo anterior al corte", () => {
    expect(sumUpTo(amounts, utc("2026-03-01").getTime()).toNumber()).toBe(150);
  });
});
