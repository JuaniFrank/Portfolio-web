import { describe, expect, it } from "vitest";
import { PriceIndex, TimeSeries } from "@/lib/rendimientos/price-series";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import {
  buildEvolutionSeries,
  type EvolutionInputs,
  type InstrumentFlow,
} from "./evolution";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const AAPL = "inst-aapl";
const GGAL = "inst-ggal";
const YPFD = "inst-ypfd";

function trade(
  instrumentId: string,
  ticker: string,
  type: "BUY" | "SELL",
  tradeDate: string,
  quantity: number,
  price: number
): TradeForHoldings {
  return {
    instrumentId,
    ticker,
    instrumentType: "CEDEAR",
    instrumentName: `${ticker} Inc.`,
    type,
    quantity: String(quantity),
    price: String(price),
    netAmount: String(quantity * price),
    tradeDate: `${tradeDate}T12:00:00.000Z`,
  };
}

/** Flujo con el mismo signo que usa el motor: + compra, − venta. */
function flow(instrumentId: string, date: string, amountArs: number): InstrumentFlow {
  return { instrumentId, time: utc(date).getTime(), amountArs };
}

function inputs(overrides: Partial<EvolutionInputs> = {}): EvolutionInputs {
  return {
    trades: [],
    prices: new PriceIndex([]),
    ccl: new TimeSeries([]),
    eventsByInstrument: new Map(),
    incomeArsByDate: [],
    flows: [],
    from: utc("2026-01-01"),
    to: utc("2026-01-03"),
    // Vacío por defecto: la serie cae al calendario completo, que es lo que la
    // mayoría de estos casos quiere afirmar. Los casos de ruedas lo pasan explícito.
    tradingDays: [],
    ...overrides,
  };
}

describe("buildEvolutionSeries — forma de la serie", () => {
  it("marca hasData en false sin operaciones", () => {
    const result = buildEvolutionSeries(inputs());
    expect(result.hasData).toBe(false);
    expect(result.series.daily).toEqual([]);
  });

  it("produce un punto por día y termina en `to`", () => {
    const result = buildEvolutionSeries(
      inputs({
        trades: [trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100)],
        flows: [flow(AAPL, "2026-01-01", 1000)],
        prices: new PriceIndex([
          { instrumentId: AAPL, date: utc("2026-01-01"), close: 100 },
          { instrumentId: AAPL, date: utc("2026-01-02"), close: 110 },
          { instrumentId: AAPL, date: utc("2026-01-03"), close: 120 },
        ]),
      })
    );

    expect(result.hasData).toBe(true);
    expect(result.series.daily.map((p) => p.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
    expect(result.series.daily.map((p) => p.valueArs)).toEqual([1000, 1100, 1200]);
    expect(result.firstDate).toBe("2026-01-01");
    expect(result.lastDate).toBe("2026-01-03");
  });

  it("calcula las tres granularidades sobre el mismo rango", () => {
    const result = buildEvolutionSeries(
      inputs({
        trades: [trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100)],
        flows: [flow(AAPL, "2026-01-01", 1000)],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-01"), close: 100 }]),
        from: utc("2026-01-01"),
        to: utc("2026-03-15"),
      })
    );

    expect(result.series.daily.length).toBeGreaterThan(result.series.weekly.length);
    expect(result.series.weekly.length).toBeGreaterThan(result.series.monthly.length);
    // Todas cierran en la misma fecha: son vistas del mismo período.
    for (const granularity of ["daily", "weekly", "monthly"] as const) {
      expect(result.series[granularity].at(-1)!.date).toBe("2026-03-15");
    }
  });
});

describe("buildEvolutionSeries — atribución de ganancia del período", () => {
  it("no cuenta una compra del período como ganancia", () => {
    // El error clásico: V_t − V_{t−1} con un aporte de por medio mide variación de
    // saldo, no rendimiento. Comprar 1000 no es ganar 1000.
    const result = buildEvolutionSeries(
      inputs({
        trades: [
          trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100),
          trade(AAPL, "AAPL", "BUY", "2026-01-02", 10, 100),
        ],
        flows: [flow(AAPL, "2026-01-01", 1000), flow(AAPL, "2026-01-02", 1000)],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-01"), close: 100 }]),
        to: utc("2026-01-02"),
      })
    );

    const second = result.series.daily[1]!;
    expect(second.valueArs).toBe(2000);
    expect(second.netFlowArs).toBe(1000);
    expect(second.changeArs).toBe(0);
    expect(second.gainers).toEqual([]);
    expect(second.losers).toEqual([]);
  });

  it("aísla la ganancia de precio cuando además hubo una compra", () => {
    const result = buildEvolutionSeries(
      inputs({
        trades: [
          trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100),
          trade(AAPL, "AAPL", "BUY", "2026-01-02", 10, 110),
        ],
        flows: [flow(AAPL, "2026-01-01", 1000), flow(AAPL, "2026-01-02", 1100)],
        prices: new PriceIndex([
          { instrumentId: AAPL, date: utc("2026-01-01"), close: 100 },
          { instrumentId: AAPL, date: utc("2026-01-02"), close: 110 },
        ]),
        to: utc("2026-01-02"),
      })
    );

    // Valor: 20 × 110 = 2200. Aporte: 1100. Ganancia real: los 10 originales
    // subieron de 100 a 110 → 100.
    const second = result.series.daily[1]!;
    expect(second.valueArs).toBe(2200);
    expect(second.changeArs).toBe(100);
    expect(second.gainers[0]!.ticker).toBe("AAPL");
    expect(second.gainers[0]!.pnlArs).toBe(100);
    expect(second.gainers[0]!.pricePercent).toBeCloseTo(10, 6);
  });

  it("no cuenta una venta del período como pérdida", () => {
    const result = buildEvolutionSeries(
      inputs({
        trades: [
          trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100),
          trade(AAPL, "AAPL", "SELL", "2026-01-02", 5, 100),
        ],
        flows: [flow(AAPL, "2026-01-01", 1000), flow(AAPL, "2026-01-02", -500)],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-01"), close: 100 }]),
        to: utc("2026-01-02"),
      })
    );

    const second = result.series.daily[1]!;
    expect(second.valueArs).toBe(500);
    expect(second.netFlowArs).toBe(-500);
    expect(second.changeArs).toBe(0);
    expect(second.losers).toEqual([]);
  });

  it("atribuye la ganancia a una posición cerrada en el período", () => {
    const result = buildEvolutionSeries(
      inputs({
        trades: [
          trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100),
          trade(AAPL, "AAPL", "SELL", "2026-01-02", 10, 150),
        ],
        flows: [flow(AAPL, "2026-01-01", 1000), flow(AAPL, "2026-01-02", -1500)],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-01"), close: 100 }]),
        to: utc("2026-01-02"),
      })
    );

    // Vendió a 150 lo que valía 1000 al cierre anterior: +500 de ganancia.
    const second = result.series.daily[1]!;
    expect(second.valueArs).toBe(0);
    expect(second.changeArs).toBe(500);
    expect(second.gainers[0]!.ticker).toBe("AAPL");
    expect(second.gainers[0]!.pnlArs).toBe(500);
  });

  it("el primer punto no reporta movers porque no tiene base de comparación", () => {
    const result = buildEvolutionSeries(
      inputs({
        trades: [trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100)],
        flows: [flow(AAPL, "2026-01-01", 1000)],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-01"), close: 150 }]),
      })
    );

    const first = result.series.daily[0]!;
    expect(first.gainers).toEqual([]);
    expect(first.losers).toEqual([]);
    expect(first.returnPercent).toBeNull();
  });
});

describe("buildEvolutionSeries — ranking de movers", () => {
  const threeTickers = (closes: Record<string, number>, day: string) => [
    { instrumentId: AAPL, date: utc(day), close: closes.AAPL! },
    { instrumentId: GGAL, date: utc(day), close: closes.GGAL! },
    { instrumentId: YPFD, date: utc(day), close: closes.YPFD! },
  ];

  const result = buildEvolutionSeries(
    inputs({
      trades: [
        trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100),
        trade(GGAL, "GGAL", "BUY", "2026-01-01", 10, 100),
        trade(YPFD, "YPFD", "BUY", "2026-01-01", 10, 100),
      ],
      flows: [
        flow(AAPL, "2026-01-01", 1000),
        flow(GGAL, "2026-01-01", 1000),
        flow(YPFD, "2026-01-01", 1000),
      ],
      prices: new PriceIndex([
        ...threeTickers({ AAPL: 100, GGAL: 100, YPFD: 100 }, "2026-01-01"),
        // AAPL +30%, GGAL −10%, YPFD −20%
        ...threeTickers({ AAPL: 130, GGAL: 90, YPFD: 80 }, "2026-01-02"),
      ]),
      to: utc("2026-01-02"),
    })
  );

  const second = result.series.daily[1]!;

  it("separa ganadores de perdedores por el signo de la ganancia", () => {
    expect(second.gainers.map((m) => m.ticker)).toEqual(["AAPL"]);
    expect(second.losers.map((m) => m.ticker)).toEqual(["YPFD", "GGAL"]);
  });

  it("ordena los perdedores de peor a menos peor", () => {
    expect(second.losers[0]!.pnlArs).toBeLessThan(second.losers[1]!.pnlArs);
  });

  it("expone la variación de precio del período", () => {
    expect(second.gainers[0]!.pricePercent).toBeCloseTo(30, 6);
    expect(second.losers[0]!.pricePercent).toBeCloseTo(-20, 6);
  });

  it("recorta cada lado a 4 posiciones", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `inst-${i}`,
      ticker: `T${i}`,
    }));
    const wide = buildEvolutionSeries(
      inputs({
        trades: many.map((m) => trade(m.id, m.ticker, "BUY", "2026-01-01", 10, 100)),
        flows: many.map((m) => flow(m.id, "2026-01-01", 1000)),
        prices: new PriceIndex([
          ...many.map((m) => ({ instrumentId: m.id, date: utc("2026-01-01"), close: 100 })),
          // Seis suben y seis bajan, todas con magnitud distinta.
          ...many.map((m, i) => ({
            instrumentId: m.id,
            date: utc("2026-01-02"),
            close: i < 6 ? 100 + (i + 1) * 5 : 100 - (i - 5) * 5,
          })),
        ]),
        to: utc("2026-01-02"),
      })
    );

    const point = wide.series.daily[1]!;
    expect(point.gainers).toHaveLength(4);
    expect(point.losers).toHaveLength(4);
  });
});

describe("buildEvolutionSeries — datos faltantes", () => {
  it("deja pricePercent en null para una posición abierta en el período", () => {
    // Sin cierre anterior no hay variación de precio: null, nunca 0. Un 0 diría
    // "no se movió", y lo que pasó es que no hay con qué comparar.
    const result = buildEvolutionSeries(
      inputs({
        trades: [
          trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100),
          trade(GGAL, "GGAL", "BUY", "2026-01-02", 10, 100),
        ],
        flows: [flow(AAPL, "2026-01-01", 1000), flow(GGAL, "2026-01-02", 1000)],
        prices: new PriceIndex([
          { instrumentId: AAPL, date: utc("2026-01-01"), close: 100 },
          { instrumentId: AAPL, date: utc("2026-01-02"), close: 100 },
          { instrumentId: GGAL, date: utc("2026-01-02"), close: 120 },
        ]),
        to: utc("2026-01-02"),
      })
    );

    const ggal = result.series.daily[1]!.gainers.find((m) => m.ticker === "GGAL");
    expect(ggal).toBeDefined();
    expect(ggal!.pricePercent).toBeNull();
  });

  it("propaga la cobertura del día y marca el arrastre de precio", () => {
    const result = buildEvolutionSeries(
      inputs({
        trades: [trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100)],
        flows: [flow(AAPL, "2026-01-01", 1000)],
        prices: new PriceIndex([{ instrumentId: AAPL, date: utc("2026-01-01"), close: 100 }]),
        to: utc("2026-01-03"),
      })
    );

    // El 02 y el 03 no tienen barra: el precio viene arrastrado del 01.
    expect(result.series.daily[1]!.coverage).toBe("partial");
    expect(result.series.daily[2]!.coverage).toBe("partial");
  });

  it("expresa valores y ganancias en USD al CCL del cierre", () => {
    const result = buildEvolutionSeries(
      inputs({
        trades: [trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100)],
        flows: [flow(AAPL, "2026-01-01", 1000)],
        prices: new PriceIndex([
          { instrumentId: AAPL, date: utc("2026-01-01"), close: 100 },
          { instrumentId: AAPL, date: utc("2026-01-02"), close: 200 },
        ]),
        ccl: new TimeSeries([
          { date: utc("2026-01-01"), value: 1000 },
          { date: utc("2026-01-02"), value: 1000 },
        ]),
        to: utc("2026-01-02"),
      })
    );

    const second = result.series.daily[1]!;
    expect(second.valueUsd).toBe(2);
    expect(second.changeUsd).toBe(1);
    expect(second.gainers[0]!.pnlUsd).toBe(1);
  });
});

describe("buildEvolutionSeries — ruedas", () => {
  const withTradingDays = (tradingDays: string[]) =>
    buildEvolutionSeries(
      inputs({
        trades: [trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100)],
        flows: [flow(AAPL, "2026-01-01", 1000)],
        prices: new PriceIndex([
          { instrumentId: AAPL, date: utc("2026-01-01"), close: 100 },
          { instrumentId: AAPL, date: utc("2026-01-02"), close: 110 },
          // 03 y 04 son sábado y domingo: no hay barra.
          { instrumentId: AAPL, date: utc("2026-01-05"), close: 120 },
        ]),
        from: utc("2026-01-01"),
        to: utc("2026-01-06"),
        tradingDays: tradingDays.map(utc),
      })
    );

  it("saltea los días sin rueda en vez de dibujar un escalón plano", () => {
    const result = withTradingDays(["2026-01-01", "2026-01-02", "2026-01-05"]);
    expect(result.series.daily.map((p) => p.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-05",
    ]);
  });

  it("termina en la última rueda, no en `to`, cuando hoy todavía no cerró", () => {
    // `to` es el 06 pero la última barra es del 05: un punto del 06 repetiría el valor
    // del 05 y sugeriría que el mercado no se movió, cuando lo que falta es el dato.
    const result = withTradingDays(["2026-01-01", "2026-01-02", "2026-01-05"]);
    expect(result.lastDate).toBe("2026-01-05");
  });

  it("no marca arrastre en un lunes cuyo precio es del propio lunes", () => {
    const result = withTradingDays(["2026-01-01", "2026-01-02", "2026-01-05"]);
    for (const point of result.series.daily) {
      expect(point.coverage).toBe("full");
      expect(point.staleTickers).toEqual([]);
    }
  });

  it("mide la variación contra la rueda anterior, salteando el fin de semana", () => {
    const result = withTradingDays(["2026-01-01", "2026-01-02", "2026-01-05"]);
    const monday = result.series.daily[2]!;
    // 110 → 120 sobre 10 nominales.
    expect(monday.changeArs).toBe(100);
    expect(monday.gainers[0]!.pricePercent).toBeCloseTo(9.0909, 3);
  });

  it("cae al calendario completo si no hay ninguna rueda", () => {
    const result = withTradingDays([]);
    expect(result.series.daily).toHaveLength(6);
    expect(result.lastDate).toBe("2026-01-06");
  });
});

describe("buildEvolutionSeries — resultado y variación de precio pueden discrepar", () => {
  // Caso real (GGAL, julio 2026): el ticker subió y la posición perdió plata, porque la
  // compra del medio se hizo por encima del precio de cierre. Ninguno de los dos números
  // está mal: uno mide el papel, el otro el resultado sobre el capital.
  const result = buildEvolutionSeries(
    inputs({
      trades: [
        trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100),
        trade(AAPL, "AAPL", "BUY", "2026-01-02", 15, 130),
      ],
      flows: [flow(AAPL, "2026-01-01", 1000), flow(AAPL, "2026-01-02", 1950)],
      prices: new PriceIndex([
        { instrumentId: AAPL, date: utc("2026-01-01"), close: 100 },
        { instrumentId: AAPL, date: utc("2026-01-02"), close: 110 },
      ]),
      to: utc("2026-01-02"),
    })
  );

  const second = result.series.daily[1]!;
  const mover = [...second.gainers, ...second.losers].find((m) => m.ticker === "AAPL")!;

  it("reporta pérdida aunque el precio del ticker haya subido", () => {
    // Valor: 25 × 110 = 2750. Antes: 1000. Aporte: 1950. Resultado: −200.
    // Las 15 nuevas se compraron a 130 y cerraron a 110: −300. Las 10 viejas: +100.
    expect(second.valueArs).toBe(2750);
    expect(mover.pnlArs).toBe(-200);
    expect(mover.pricePercent).toBeCloseTo(10, 6);
  });

  it("marca la fila como operada para que la discrepancia sea explicable", () => {
    expect(mover.hadFlow).toBe(true);
  });

  it("no marca las filas sin operaciones en el período", () => {
    const quiet = buildEvolutionSeries(
      inputs({
        trades: [trade(AAPL, "AAPL", "BUY", "2026-01-01", 10, 100)],
        flows: [flow(AAPL, "2026-01-01", 1000)],
        prices: new PriceIndex([
          { instrumentId: AAPL, date: utc("2026-01-01"), close: 100 },
          { instrumentId: AAPL, date: utc("2026-01-02"), close: 110 },
        ]),
        to: utc("2026-01-02"),
      })
    );
    expect(quiet.series.daily[1]!.gainers[0]!.hadFlow).toBe(false);
  });
});
