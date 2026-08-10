import { describe, expect, it } from "vitest";
import { buildHoldings, type TradeForHoldings } from "@/lib/transactions/holdings";
import type { CorporateEventForBuilder } from "./types";
import { applyEventsToTrade } from "./apply";

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
