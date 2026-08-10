import { describe, expect, it } from "vitest";
import type { TransactionType } from "@/lib/generated/prisma";
import {
  classifyCapitalFlows,
  classifyIncome,
  isCapitalFlow,
  isIncome,
  isUsdCurrency,
} from "./cashflows";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function tx(
  type: TransactionType,
  netAmount: number,
  overrides: { currencyCode?: string; day?: string; eligible?: boolean } = {}
) {
  return {
    type,
    tradeDate: utc(overrides.day ?? "2026-01-10"),
    netAmount,
    currencyCode: overrides.currencyCode ?? "ARS",
    instrumentEligible: overrides.eligible ?? true,
  };
}

describe("isCapitalFlow", () => {
  it("reconoce compras y ventas como movimiento de capital", () => {
    // Una compra ES la prueba de que entró plata: no hace falta un DEPOSIT cargado.
    expect(isCapitalFlow("BUY")).toBe(true);
    expect(isCapitalFlow("SELL")).toBe(true);
  });

  it("IGNORA depósitos, retiros y transferencias", () => {
    // El perímetro es el capital invertido, no el saldo del broker. Mover plata entre
    // el banco y la cuenta no cambia cuánto rindieron los activos.
    expect(isCapitalFlow("DEPOSIT")).toBe(false);
    expect(isCapitalFlow("WITHDRAWAL")).toBe(false);
    expect(isCapitalFlow("TRANSFER_IN")).toBe(false);
    expect(isCapitalFlow("TRANSFER_OUT")).toBe(false);
  });

  it("no confunde renta con capital", () => {
    expect(isCapitalFlow("DIVIDEND_CASH")).toBe(false);
    expect(isCapitalFlow("FEE")).toBe(false);
  });
});

describe("isIncome", () => {
  it("cuenta la renta generada por las posiciones", () => {
    expect(isIncome("DIVIDEND_CASH")).toBe(true);
    expect(isIncome("COUPON")).toBe(true);
    expect(isIncome("INTEREST")).toBe(true);
    expect(isIncome("AMORTIZATION")).toBe(true);
  });

  it("cuenta los costos que pesan sobre las posiciones", () => {
    expect(isIncome("FEE")).toBe(true);
    expect(isIncome("TAX_WITHHOLDING")).toBe(true);
  });

  it("no cuenta compras, ventas ni movimientos de efectivo", () => {
    expect(isIncome("BUY")).toBe(false);
    expect(isIncome("SELL")).toBe(false);
    expect(isIncome("DEPOSIT")).toBe(false);
    expect(isIncome("FX_CONVERSION")).toBe(false);
  });
});

describe("isUsdCurrency", () => {
  it("agrupa las especies de dólar que reportan los brokers", () => {
    for (const code of ["USD", "USD_MEP", "USD_CABLE", "USDT", "USDC"]) {
      expect(isUsdCurrency(code)).toBe(true);
    }
  });

  it("es insensible a mayúsculas", () => {
    expect(isUsdCurrency("usd")).toBe(true);
  });

  it("trata todo lo demás como ARS", () => {
    expect(isUsdCurrency("ARS")).toBe(false);
    expect(isUsdCurrency("EUR")).toBe(false);
  });
});

describe("classifyCapitalFlows", () => {
  it("la compra suma capital y la venta lo saca", () => {
    const flows = classifyCapitalFlows([tx("BUY", 100_000), tx("SELL", 40_000)]);
    expect(flows.map((flow) => flow.amount)).toEqual([100_000, -40_000]);
  });

  it("descarta por completo los movimientos de efectivo", () => {
    const flows = classifyCapitalFlows([
      tx("DEPOSIT", 500_000),
      tx("WITHDRAWAL", 200_000),
      tx("TRANSFER_IN", 100_000),
      tx("TRANSFER_OUT", 50_000),
      tx("FX_CONVERSION", 10_000),
    ]);
    expect(flows).toEqual([]);
  });

  it("mide igual con o sin depósitos cargados", () => {
    const conDepositos = classifyCapitalFlows([tx("DEPOSIT", 500_000), tx("BUY", 100_000)]);
    const sinDepositos = classifyCapitalFlows([tx("BUY", 100_000)]);
    expect(conDepositos).toEqual(sinDepositos);
  });

  it("usa el tipo y no el signo del importe para decidir la dirección", () => {
    // Distintos importadores registran el signo de forma inconsistente.
    const flows = classifyCapitalFlows([tx("SELL", -40_000), tx("BUY", -100_000)]);
    expect(flows.map((flow) => flow.amount)).toEqual([-40_000, 100_000]);
  });

  it("excluye instrumentos que no entran en el cálculo", () => {
    // Una compra de una ON no puede sumar capital a un perímetro del que la ON
    // ni siquiera forma parte.
    const flows = classifyCapitalFlows([
      tx("BUY", 100_000, { eligible: false }),
      tx("BUY", 50_000),
    ]);
    expect(flows).toHaveLength(1);
    expect(flows[0]!.amount).toBe(50_000);
  });

  it("rutea la moneda del movimiento", () => {
    const flows = classifyCapitalFlows([
      tx("BUY", 1_000, { currencyCode: "USD" }),
      tx("BUY", 100_000),
    ]);
    expect(flows.map((flow) => flow.currency)).toEqual(["USD", "ARS"]);
  });

  it("descarta importes cero y no finitos", () => {
    const flows = classifyCapitalFlows([
      tx("BUY", 0),
      tx("BUY", Number.NaN),
      tx("BUY", 1_000),
    ]);
    expect(flows).toHaveLength(1);
  });

  it("ordena por fecha ascendente", () => {
    // El caso de tres compras espaciadas: el orden importa porque Modified Dietz
    // pondera cada una por el día en que ocurrió.
    const flows = classifyCapitalFlows([
      tx("BUY", 1_200, { day: "2026-01-31" }),
      tx("BUY", 1_000, { day: "2026-01-01" }),
      tx("BUY", 1_100, { day: "2026-01-16" }),
    ]);
    expect(flows.map((flow) => flow.amount)).toEqual([1_000, 1_100, 1_200]);
    expect(flows.map((flow) => flow.date.getUTCDate())).toEqual([1, 16, 31]);
  });
});

describe("classifyIncome", () => {
  it("la renta suma y los costos restan", () => {
    const income = classifyIncome([
      tx("DIVIDEND_CASH", 5_000),
      tx("COUPON", 3_000),
      tx("INTEREST", 1_000),
      tx("FEE", 500),
      tx("TAX_WITHHOLDING", 200),
    ]);
    expect(income.map((event) => event.amount)).toEqual([5_000, 3_000, 1_000, -500, -200]);
  });

  it("no incluye compras ni ventas", () => {
    expect(classifyIncome([tx("BUY", 100_000), tx("SELL", 40_000)])).toEqual([]);
  });

  it("no incluye movimientos de efectivo", () => {
    expect(classifyIncome([tx("DEPOSIT", 100_000), tx("WITHDRAWAL", 40_000)])).toEqual([]);
  });

  it("excluye la renta de instrumentos fuera del cálculo", () => {
    const income = classifyIncome([tx("COUPON", 3_000, { eligible: false })]);
    expect(income).toEqual([]);
  });
});
