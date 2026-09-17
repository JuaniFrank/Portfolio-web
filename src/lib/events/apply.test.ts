import { describe, expect, it } from "vitest";
import { buildHoldings, type TradeForHoldings } from "@/lib/transactions/holdings";
import type { CorporateEventForBuilder } from "./types";
import { adjustBarsForEvents, applyEventsToTrade, type HistoricalBar } from "./apply";

function trade(overrides: Partial<TradeForHoldings> = {}): TradeForHoldings {
  return {
    instrumentId: "aapl-cedear",
    ticker: "AAPL",
    instrumentType: "CEDEAR",
    instrumentName: "Apple Inc.",
    type: "BUY",
    quantity: "10",
    price: "1000",
    netAmount: "10000",
    tradeDate: "2025-06-15T00:00:00.000Z",
    ...overrides,
  };
}

/** Cambio de ratio 20:1 — el CEDEAR pasa a representar 20 veces más nominales. */
const RATIO_20_TO_1: CorporateEventForBuilder = {
  instrumentId: "aapl-cedear",
  eventType: "CEDEAR_RATIO_CHANGE",
  effectiveDate: "2025-09-01",
  numerator: "20",
  denominator: "1",
};

describe("applyEventsToTrade", () => {
  it("ajusta una operación anterior al evento", () => {
    const adjusted = applyEventsToTrade(trade(), [RATIO_20_TO_1]);
    expect(Number(adjusted.quantity)).toBeCloseTo(200, 8);
    expect(Number(adjusted.price)).toBeCloseTo(50, 8);
  });

  it("deja intacto el netAmount: el evento no cambia lo que se pagó", () => {
    const adjusted = applyEventsToTrade(trade(), [RATIO_20_TO_1]);
    expect(adjusted.netAmount).toBe("10000");
  });

  it("NO ajusta una operación posterior al evento", () => {
    const posterior = trade({ tradeDate: "2025-10-01T00:00:00.000Z" });
    const adjusted = applyEventsToTrade(posterior, [RATIO_20_TO_1]);
    expect(adjusted.quantity).toBe("10");
    expect(adjusted.price).toBe("1000");
  });

  it("no ajusta una operación del mismo día del evento", () => {
    const mismoDia = trade({ tradeDate: "2025-09-01T00:00:00.000Z" });
    expect(applyEventsToTrade(mismoDia, [RATIO_20_TO_1]).quantity).toBe("10");
  });

  it("TICKER_CHANGE no aplica matemática", () => {
    const rename: CorporateEventForBuilder = {
      ...RATIO_20_TO_1,
      eventType: "TICKER_CHANGE",
    };
    const adjusted = applyEventsToTrade(trade(), [rename]);
    expect(adjusted.quantity).toBe("10");
    expect(adjusted.price).toBe("1000");
  });

  it("compone varios eventos consecutivos", () => {
    const segundo: CorporateEventForBuilder = {
      ...RATIO_20_TO_1,
      effectiveDate: "2025-11-01",
      numerator: "2",
      denominator: "1",
    };
    const adjusted = applyEventsToTrade(trade(), [RATIO_20_TO_1, segundo]);
    expect(Number(adjusted.quantity)).toBeCloseTo(400, 8);
    expect(Number(adjusted.price)).toBeCloseTo(25, 8);
  });
});

describe("adjustBarsForEvents", () => {
  const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  const bar = (date: string, close: number, overrides: Partial<HistoricalBar> = {}): HistoricalBar => ({
    date: utc(date),
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
    ...overrides,
  });

  it("divide por el ratio los precios anteriores al evento", () => {
    // Misma regla que `applyEventsToTrade`: pre-evento, price / ratio.
    const [adjusted] = adjustBarsForEvents([bar("2025-06-15", 1000)], [RATIO_20_TO_1]);
    expect(adjusted!.close).toBeCloseTo(50, 8);
    expect(adjusted!.open).toBeCloseTo(50, 8);
    expect(adjusted!.high).toBeCloseTo(50, 8);
    expect(adjusted!.low).toBeCloseTo(50, 8);
  });

  it("NO ajusta una rueda posterior al evento", () => {
    const [adjusted] = adjustBarsForEvents([bar("2025-10-01", 60)], [RATIO_20_TO_1]);
    expect(adjusted!.close).toBe(60);
  });

  it("no ajusta la rueda del mismo día del evento", () => {
    const [adjusted] = adjustBarsForEvents([bar("2025-09-01", 60)], [RATIO_20_TO_1]);
    expect(adjusted!.close).toBe(60);
  });

  it("TICKER_CHANGE no aplica matemática", () => {
    const rename: CorporateEventForBuilder = { ...RATIO_20_TO_1, eventType: "TICKER_CHANGE" };
    const [adjusted] = adjustBarsForEvents([bar("2025-06-15", 1000)], [rename]);
    expect(adjusted!.close).toBe(1000);
  });

  it("compone varios eventos consecutivos", () => {
    const segundo: CorporateEventForBuilder = {
      ...RATIO_20_TO_1,
      effectiveDate: "2025-11-01",
      numerator: "2",
      denominator: "1",
    };
    const [adjusted] = adjustBarsForEvents([bar("2025-06-15", 1000)], [RATIO_20_TO_1, segundo]);
    expect(adjusted!.close).toBeCloseTo(25, 8);
  });

  it("deja el volumen intacto: es nocional en ARS, invariante ante un split", () => {
    const [adjusted] = adjustBarsForEvents([bar("2025-06-15", 1000)], [RATIO_20_TO_1]);
    expect(adjusted!.volume).toBe(1000);
  });

  it("tolera open/high/low nulos sin romper el close", () => {
    const sinOhl = bar("2025-06-15", 1000, { open: null, high: null, low: null });
    const [adjusted] = adjustBarsForEvents([sinOhl], [RATIO_20_TO_1]);
    expect(adjusted!.open).toBeNull();
    expect(adjusted!.close).toBeCloseTo(50, 8);
  });

  it("ignora eventos con denominador cero en vez de producir Infinity", () => {
    const roto: CorporateEventForBuilder = { ...RATIO_20_TO_1, denominator: "0" };
    const [adjusted] = adjustBarsForEvents([bar("2025-06-15", 1000)], [roto]);
    expect(adjusted!.close).toBe(1000);
  });

  it("sin eventos devuelve las barras tal cual", () => {
    const original = [bar("2025-06-15", 1000)];
    expect(adjustBarsForEvents(original, [])).toEqual(original);
  });

  // Casos reales medidos contra data912 + nuestra serie de Yahoo (ya ajustada).
  describe("casos reales de la base", () => {
    it("SPY: cambio de ratio 3:1 del 2026-05-29", () => {
      const spy: CorporateEventForBuilder = {
        instrumentId: "spy",
        eventType: "CEDEAR_RATIO_CHANGE",
        effectiveDate: "2026-05-29",
        numerator: "3",
        denominator: "1",
      };
      // data912 devuelve el nominal crudo: 54225 el 2025-10-21. Yahoo (ya ajustado)
      // tenía 18050 ese día.
      const [adjusted] = adjustBarsForEvents([bar("2025-10-21", 54225)], [spy]);
      expect(adjusted!.close).toBeCloseTo(18075, 0);
    });

    it("YPFD: split 10:1 del 2026-08-03", () => {
      const ypfd: CorporateEventForBuilder = {
        instrumentId: "ypfd",
        eventType: "STOCK_SPLIT",
        effectiveDate: "2026-08-03",
        numerator: "10",
        denominator: "1",
      };
      // data912: 40120 el 2025-10-17. Yahoo (ajustado): 4026.
      const [adjusted] = adjustBarsForEvents([bar("2025-10-17", 40120)], [ypfd]);
      expect(adjusted!.close).toBeCloseTo(4012, 0);
    });
  });
});

describe("buildHoldings con eventos — lo que consume /rendimientos", () => {
  const events = new Map([["aapl-cedear", [RATIO_20_TO_1]]]);

  it("un cambio de ratio no inventa ni destruye valor por sí solo", () => {
    // Post-evento, el mercado cotiza el CEDEAR a 1/20 del precio anterior. Con la
    // cantidad ajustada ×20, el valor de la posición tiene que ser el mismo.
    const precioPostEvento = new Map([["aapl-cedear", "60"]]);
    const conEventos = buildHoldings([trade()], precioPostEvento, events);
    expect(Number(conEventos[0]!.quantity)).toBeCloseTo(200, 6);
    expect(Number(conEventos[0]!.marketValueArs)).toBeCloseTo(12_000, 2);

    // Sin aplicar el evento, la misma posición valdría 20 veces menos: es exactamente
    // el error que /rendimientos mostraría si ignorara los eventos corporativos.
    const sinEventos = buildHoldings([trade()], precioPostEvento);
    expect(Number(sinEventos[0]!.marketValueArs)).toBeCloseTo(600, 2);
  });

  it("el costo en cartera no cambia por el evento", () => {
    const holdings = buildHoldings([trade()], new Map([["aapl-cedear", "60"]]), events);
    expect(Number(holdings[0]!.costBasisArs)).toBeCloseTo(10_000, 2);
  });

  it("mezcla operaciones previas y posteriores al evento", () => {
    const previa = trade();
    const posterior = trade({
      tradeDate: "2025-10-01T00:00:00.000Z",
      quantity: "100",
      price: "55",
      netAmount: "5500",
    });
    const holdings = buildHoldings([previa, posterior], new Map([["aapl-cedear", "60"]]), events);
    // 200 (ajustadas) + 100 (as-traded) = 300
    expect(Number(holdings[0]!.quantity)).toBeCloseTo(300, 6);
    expect(Number(holdings[0]!.costBasisArs)).toBeCloseTo(15_500, 2);
  });
});
