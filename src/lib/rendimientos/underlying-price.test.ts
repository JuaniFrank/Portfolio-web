import { describe, expect, it } from "vitest";
import type { CorporateEventForBuilder } from "@/lib/events/types";
import type { TradeForHoldings } from "@/lib/transactions/holdings";
import {
  closeOnOrBefore,
  formatExchangeName,
  underlyingAverageCost,
  underlyingSymbolFor,
  type UnderlyingBar,
} from "./underlying-price";

describe("underlyingSymbolFor", () => {
  it("devuelve el ticker del CEDEAR como símbolo de Yahoo cuando no hay nada más", () => {
    expect(underlyingSymbolFor({ type: "CEDEAR", ticker: "META" })).toBe("META");
  });

  it("devuelve null para instrumentos que no son CEDEARs", () => {
    expect(underlyingSymbolFor({ type: "STOCK_AR", ticker: "GGAL" })).toBeNull();
    expect(underlyingSymbolFor({ type: "BOND_AR", ticker: "AL30" })).toBeNull();
  });

  it("prefiere el ticker del activo subyacente al ticker del CEDEAR", () => {
    expect(
      underlyingSymbolFor({ type: "CEDEAR", ticker: "BRKB", underlyingAssetTicker: "BRK.B" })
    ).toBe("BRK-B");
  });

  it("resuelve las variantes de liquidación por el instrumento base", () => {
    expect(
      underlyingSymbolFor({
        type: "CEDEAR",
        ticker: "METAD",
        baseInstrument: { ticker: "META", underlyingAssetTicker: null },
      })
    ).toBe("META");
  });

  it("prefiere el subyacente del base al ticker del base", () => {
    expect(
      underlyingSymbolFor({
        type: "CEDEAR",
        ticker: "BRKBC",
        baseInstrument: { ticker: "BRKB", underlyingAssetTicker: "BRK.B" },
      })
    ).toBe("BRK-B");
  });

  it("normaliza espacios y minúsculas, y reemplaza el punto por guion", () => {
    expect(underlyingSymbolFor({ type: "CEDEAR", ticker: " bf.b " })).toBe("BF-B");
  });

  it("devuelve null con un ticker vacío", () => {
    expect(underlyingSymbolFor({ type: "CEDEAR", ticker: "  " })).toBeNull();
  });
});

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function trade(type: "BUY" | "SELL", day: string, quantity: number): TradeForHoldings {
  return {
    instrumentId: "inst-meta",
    ticker: "META",
    instrumentType: "CEDEAR",
    instrumentName: "Meta",
    type,
    quantity: String(quantity),
    price: "1",
    netAmount: String(quantity),
    tradeDate: `${day}T15:00:00.000Z`,
  };
}

const bars: UnderlyingBar[] = [
  { date: utc("2026-03-02"), close: 100 },
  { date: utc("2026-03-03"), close: 110 },
  { date: utc("2026-03-06"), close: 200 }, // viernes
  { date: utc("2026-03-09"), close: 220 },
  { date: utc("2026-06-01"), close: 300 },
];

describe("closeOnOrBefore", () => {
  it("devuelve el cierre del propio día cuando hubo rueda", () => {
    expect(closeOnOrBefore(bars, utc("2026-03-03"))).toBe(110);
  });

  it("usa el cierre de la rueda anterior en fin de semana o feriado", () => {
    expect(closeOnOrBefore(bars, utc("2026-03-07"))).toBe(200); // sábado
    expect(closeOnOrBefore(bars, utc("2026-03-08"))).toBe(200); // domingo
  });

  it("devuelve null antes de la primera rueda", () => {
    expect(closeOnOrBefore(bars, utc("2026-03-01"))).toBeNull();
  });

  it("devuelve null si la rueda anterior queda demasiado lejos (hueco de datos)", () => {
    expect(closeOnOrBefore(bars, utc("2026-05-01"))).toBeNull();
  });

  it("devuelve null sin ruedas", () => {
    expect(closeOnOrBefore([], utc("2026-03-03"))).toBeNull();
  });
});

describe("underlyingAverageCost", () => {
  it("promedia los cierres de las fechas de compra ponderados por cantidad", () => {
    const result = underlyingAverageCost(
      [trade("BUY", "2026-03-02", 10), trade("BUY", "2026-03-06", 30)],
      [],
      bars
    );
    expect(result).toBeCloseTo((10 * 100 + 30 * 200) / 40, 10);
  });

  it("usa el cierre anterior cuando la compra cae en fin de semana", () => {
    const result = underlyingAverageCost([trade("BUY", "2026-03-07", 5)], [], bars);
    expect(result).toBe(200);
  });

  it("una venta parcial no cambia el promedio", () => {
    const result = underlyingAverageCost(
      [trade("BUY", "2026-03-02", 10), trade("BUY", "2026-03-06", 10), trade("SELL", "2026-03-09", 5)],
      [],
      bars
    );
    expect(result).toBeCloseTo(150, 10);
  });

  it("después de vender uno de los lotes, las compras siguientes se promedian sobre lo que queda", () => {
    const result = underlyingAverageCost(
      [trade("BUY", "2026-03-02", 10), trade("SELL", "2026-03-03", 5), trade("BUY", "2026-03-06", 5)],
      [],
      bars
    );
    // quedan 5 a 100 y se suman 5 a 200
    expect(result).toBeCloseTo(150, 10);
  });

  it("una venta total reinicia el promedio: solo cuenta el lote abierto", () => {
    const result = underlyingAverageCost(
      [trade("BUY", "2026-03-02", 10), trade("SELL", "2026-03-03", 10), trade("BUY", "2026-03-09", 4)],
      [],
      bars
    );
    expect(result).toBe(220);
  });

  it("devuelve null sin posición abierta", () => {
    const result = underlyingAverageCost(
      [trade("BUY", "2026-03-02", 10), trade("SELL", "2026-03-03", 10)],
      [],
      bars
    );
    expect(result).toBeNull();
  });

  it("devuelve null si una compra del lote abierto no tiene cierre", () => {
    const result = underlyingAverageCost(
      [trade("BUY", "2026-01-05", 10), trade("BUY", "2026-03-06", 10)],
      [],
      bars
    );
    expect(result).toBeNull();
  });

  it("ignora una compra sin cierre si el lote se cerró después", () => {
    const result = underlyingAverageCost(
      [trade("BUY", "2026-01-05", 10), trade("SELL", "2026-03-02", 10), trade("BUY", "2026-03-06", 2)],
      [],
      bars
    );
    expect(result).toBe(200);
  });

  it("ajusta las cantidades previas a un cambio de ratio como el pipeline de holdings", () => {
    const events: CorporateEventForBuilder[] = [
      {
        instrumentId: "inst-meta",
        eventType: "CEDEAR_RATIO_CHANGE",
        effectiveDate: "2026-03-05",
        numerator: "3",
        denominator: "1",
      },
    ];
    const result = underlyingAverageCost(
      [trade("BUY", "2026-03-02", 10), trade("BUY", "2026-03-06", 30)],
      events,
      bars
    );
    // 10 × 3 = 30 a 100, más 30 a 200
    expect(result).toBeCloseTo(150, 10);
  });

  it("ordena las operaciones por fecha aunque lleguen desordenadas", () => {
    const result = underlyingAverageCost(
      [trade("SELL", "2026-03-03", 10), trade("BUY", "2026-03-09", 4), trade("BUY", "2026-03-02", 10)],
      [],
      bars
    );
    expect(result).toBe(220);
  });
});

describe("formatExchangeName", () => {
  it("unifica las variantes de Nasdaq", () => {
    expect(formatExchangeName("NasdaqGS")).toBe("NASDAQ");
    expect(formatExchangeName("NasdaqGM")).toBe("NASDAQ");
    expect(formatExchangeName("NasdaqCM")).toBe("NASDAQ");
  });

  it("conserva NYSE y deja el resto tal cual", () => {
    expect(formatExchangeName("NYSE")).toBe("NYSE");
    expect(formatExchangeName("NYSEArca")).toBe("NYSE Arca");
    expect(formatExchangeName("Toronto")).toBe("Toronto");
  });

  it("devuelve null sin nombre", () => {
    expect(formatExchangeName(null)).toBeNull();
    expect(formatExchangeName("  ")).toBeNull();
    expect(formatExchangeName(undefined)).toBeNull();
  });
});
