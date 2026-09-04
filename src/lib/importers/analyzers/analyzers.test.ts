import { describe, expect, it } from "vitest";
import { InstrumentType, TransactionType } from "@/lib/generated/prisma";
import {
  computeAutoClearSummary,
  getExcludedRowNumbersForCategories,
} from "../auto-clear";
import { getBrokerAnalyzer, BROKER_ANALYZERS } from "../registry";
import type { NormalizedImportRow } from "../types";

describe("Broker Analyzers & Auto-Clear Modular Architecture", () => {
  it("registers all broker analyzers properly", () => {
    const balanz = getBrokerAnalyzer("BALANZ");
    const cocos = getBrokerAnalyzer("COCOS");
    const iol = getBrokerAnalyzer("IOL");

    expect(balanz.code).toBe("BALANZ");
    expect(balanz.name).toBe("Balanz");
    expect(balanz.supportedFileKinds).toContain("XLSX");

    expect(cocos.code).toBe("COCOS");
    expect(cocos.name).toBe("Cocos Capital");

    expect(iol.code).toBe("IOL");
    expect(iol.name).toBe("InvertirOnline");
    expect(iol.supportedFileKinds).toEqual(["XLSX", "CSV"]);
  });

  it("throws for unknown broker codes", () => {
    // @ts-expect-error Testing invalid broker code
    expect(() => getBrokerAnalyzer("UNKNOWN")).toThrow();
  });

  it("computes Auto-Clear summary with accurate categorizations", () => {
    const mockRows: NormalizedImportRow[] = [
      {
        rowNumber: 1,
        status: "valid",
        messages: [],
        raw: {
          Descripcion: "Recibo de Cobro",
          Ticker: "",
          "Tipo de Instrumento": "",
          Concertacion: "2024-01-10",
          Cantidad: 0,
          Precio: 0,
          Liquidacion: "2024-01-10",
          Moneda: "ARS",
          Importe: 100000,
        },
        parsed: {
          type: TransactionType.DEPOSIT,
          tradeDate: "2024-01-10T12:00:00.000Z",
          settlementDate: "2024-01-10T12:00:00.000Z",
          ticker: null,
          instrumentType: null,
          quantity: "0",
          price: null,
          currencyCode: "ARS",
          grossAmount: "100000",
          netAmount: "100000",
          externalId: null,
          description: "Recibo de Cobro",
          brokerFxRate: null,
        },
      },
      {
        rowNumber: 2,
        status: "valid",
        messages: [],
        raw: {
          Descripcion: "Boleto AL30",
          Ticker: "AL30",
          "Tipo de Instrumento": "Bonos",
          Concertacion: "2024-01-11",
          Cantidad: 50,
          Precio: 60,
          Liquidacion: "2024-01-11",
          Moneda: "USD",
          Importe: 3000,
        },
        parsed: {
          type: TransactionType.BUY,
          tradeDate: "2024-01-11T12:00:00.000Z",
          settlementDate: "2024-01-11T12:00:00.000Z",
          ticker: "AL30",
          instrumentType: InstrumentType.BOND_AR,
          quantity: "50",
          price: "60",
          currencyCode: "USD",
          grossAmount: "3000",
          netAmount: "3000",
          externalId: null,
          description: "Boleto AL30",
          brokerFxRate: null,
        },
      },
      {
        rowNumber: 3,
        status: "valid",
        messages: [],
        raw: {
          Descripcion: "Boleto TVPP",
          Ticker: "TVPP",
          "Tipo de Instrumento": "Cedears",
          Concertacion: "2024-01-12",
          Cantidad: 10,
          Precio: 100,
          Liquidacion: "2024-01-12",
          Moneda: "ARS",
          Importe: 1000,
        },
        parsed: {
          type: TransactionType.BUY,
          tradeDate: "2024-01-12T12:00:00.000Z",
          settlementDate: "2024-01-12T12:00:00.000Z",
          ticker: "TVPP",
          instrumentType: InstrumentType.CEDEAR,
          quantity: "10",
          price: "100",
          currencyCode: "ARS",
          grossAmount: "1000",
          netAmount: "1000",
          externalId: null,
          description: "Boleto TVPP",
          brokerFxRate: null,
        },
      },
    ];

    const amortizedTickers = new Set(["TVPP"]);
    const summary = computeAutoClearSummary(mockRows, amortizedTickers);

    expect(summary.totalExcluded).toBe(3);
    expect(summary.counts.cash_movement).toBe(1);
    expect(summary.counts.unsupported_instrument).toBe(1);
    expect(summary.counts.amortized_ticker).toBe(1);
    expect(summary.byCategory.cash_movement).toEqual([1]);
    expect(summary.byCategory.unsupported_instrument).toEqual([2]);
    expect(summary.byCategory.amortized_ticker).toEqual([3]);

    // Selective filtering
    const onlyCash = getExcludedRowNumbersForCategories(summary, new Set(["cash_movement"]));
    expect(onlyCash).toEqual([1]);

    const cashAndBonds = getExcludedRowNumbersForCategories(
      summary,
      new Set(["cash_movement", "unsupported_instrument"])
    );
    expect(cashAndBonds).toEqual([1, 2]);
  });
});
