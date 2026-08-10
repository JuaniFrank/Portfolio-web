import { describe, expect, it } from "vitest";
import type { TransactionType } from "@/lib/generated/prisma";
import { classifyExternalFlows, isExternalFlow, isUsdCurrency } from "./cashflows";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function tx(type: TransactionType, netAmount: number, currencyCode = "ARS", day = "2026-01-10") {
  return { type, tradeDate: utc(day), netAmount, currencyCode };
}

describe("isExternalFlow", () => {
  it("reconoce como externos solo los movimientos de capital", () => {
    expect(isExternalFlow("DEPOSIT")).toBe(true);
    expect(isExternalFlow("WITHDRAWAL")).toBe(true);
    expect(isExternalFlow("TRANSFER_IN")).toBe(true);
    expect(isExternalFlow("TRANSFER_OUT")).toBe(true);
  });

  it("NO cuenta compras ni ventas como aportes", () => {
    // Este es el error que arruinaba el cálculo anterior: una compra es una
    // reasignación interna de efectivo a activo, no plata nueva.
    expect(isExternalFlow("BUY")).toBe(false);
    expect(isExternalFlow("SELL")).toBe(false);
  });

  it("NO cuenta como aporte el retorno que genera la cartera", () => {
    expect(isExternalFlow("DIVIDEND_CASH")).toBe(false);
    expect(isExternalFlow("COUPON")).toBe(false);
    expect(isExternalFlow("AMORTIZATION")).toBe(false);
    expect(isExternalFlow("INTEREST")).toBe(false);
  });

  it("NO cuenta como aporte los costos ni el cambio de moneda", () => {
    expect(isExternalFlow("FEE")).toBe(false);
    expect(isExternalFlow("TAX_WITHHOLDING")).toBe(false);
    expect(isExternalFlow("FX_CONVERSION")).toBe(false);
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

describe("classifyExternalFlows", () => {
  it("filtra todo lo interno", () => {
    const flows = classifyExternalFlows([
      tx("BUY", 50_000),
      tx("SELL", 30_000),
      tx("DIVIDEND_CASH", 1_000),
      tx("FEE", 200),
      tx("FX_CONVERSION", 10_000),
    ]);
    expect(flows).toEqual([]);
  });

  it("firma los aportes en positivo y los retiros en negativo", () => {
    const flows = classifyExternalFlows([
      tx("DEPOSIT", 100_000),
      tx("TRANSFER_IN", 50_000),
      tx("WITHDRAWAL", 20_000),
      tx("TRANSFER_OUT", 10_000),
    ]);
    expect(flows.map((flow) => flow.amount)).toEqual([100_000, 50_000, -20_000, -10_000]);
  });

  it("usa el tipo y no el signo del importe para decidir la dirección", () => {
    // Distintos importadores registran el signo de forma inconsistente; el único
    // dato confiable es el `type`.
    const flows = classifyExternalFlows([tx("WITHDRAWAL", -20_000), tx("DEPOSIT", -5_000)]);
    expect(flows.map((flow) => flow.amount)).toEqual([-20_000, 5_000]);
  });

  it("rutea la moneda del flujo", () => {
    const flows = classifyExternalFlows([
      tx("DEPOSIT", 1_000, "USD"),
      tx("DEPOSIT", 100_000, "ARS"),
    ]);
    expect(flows.map((flow) => flow.currency)).toEqual(["USD", "ARS"]);
  });

  it("descarta importes cero y no finitos", () => {
    const flows = classifyExternalFlows([
      tx("DEPOSIT", 0),
      tx("DEPOSIT", Number.NaN),
      tx("DEPOSIT", 1_000),
    ]);
    expect(flows).toHaveLength(1);
  });

  it("ordena por fecha ascendente", () => {
    const flows = classifyExternalFlows([
      tx("DEPOSIT", 300, "ARS", "2026-03-01"),
      tx("DEPOSIT", 100, "ARS", "2026-01-01"),
      tx("DEPOSIT", 200, "ARS", "2026-02-01"),
    ]);
    expect(flows.map((flow) => flow.amount)).toEqual([100, 200, 300]);
  });
});
