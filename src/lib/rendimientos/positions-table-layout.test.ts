import { describe, expect, it } from "vitest";
import {
  compareNullableAlphabetical,
  compareNullableNumeric,
  parseStoredLayout,
  reconcileColumnOrder,
  serializeLayout,
  type PositionsTableLayout,
} from "./positions-table-layout";

describe("compareNullableNumeric", () => {
  it("ordena ascendente por valor", () => {
    expect(compareNullableNumeric(1, 2, "asc")).toBeLessThan(0);
    expect(compareNullableNumeric(2, 1, "asc")).toBeGreaterThan(0);
  });

  it("ordena descendente por valor", () => {
    expect(compareNullableNumeric(2, 1, "desc")).toBeLessThan(0);
    expect(compareNullableNumeric(1, 2, "desc")).toBeGreaterThan(0);
  });

  it("los nulos siempre van al final, en asc y en desc", () => {
    expect(compareNullableNumeric(null, 1, "asc")).toBeGreaterThan(0);
    expect(compareNullableNumeric(1, null, "asc")).toBeLessThan(0);
    expect(compareNullableNumeric(null, 1, "desc")).toBeGreaterThan(0);
    expect(compareNullableNumeric(1, null, "desc")).toBeLessThan(0);
  });

  it("dos nulos son iguales", () => {
    expect(compareNullableNumeric(null, null, "asc")).toBe(0);
  });
});

describe("compareNullableAlphabetical", () => {
  it("ordena ascendente por texto", () => {
    expect(compareNullableAlphabetical("AAPL", "GGAL", "asc")).toBeLessThan(0);
  });

  it("ordena descendente por texto", () => {
    expect(compareNullableAlphabetical("GGAL", "AAPL", "desc")).toBeLessThan(0);
  });

  it("los nulos siempre van al final, en asc y en desc", () => {
    expect(compareNullableAlphabetical(null, "AAPL", "asc")).toBeGreaterThan(0);
    expect(compareNullableAlphabetical("AAPL", null, "desc")).toBeLessThan(0);
  });

  it("dos nulos son iguales", () => {
    expect(compareNullableAlphabetical(null, null, "desc")).toBe(0);
  });
});

describe("parseStoredLayout", () => {
  it("devuelve null sin nada guardado", () => {
    expect(parseStoredLayout(null)).toBeNull();
  });

  it("devuelve null ante JSON inválido", () => {
    expect(parseStoredLayout("{not json")).toBeNull();
  });

  it("devuelve null ante un JSON válido que no es un objeto", () => {
    expect(parseStoredLayout("42")).toBeNull();
    expect(parseStoredLayout("[1,2,3]")).toBeNull();
  });

  it("recupera un layout completo y válido", () => {
    const stored: PositionsTableLayout = {
      columnOrder: ["ticker", "price"],
      columnSizing: { ticker: 200 },
      columnVisibility: { price: false },
      sorting: [{ id: "ticker", desc: false }],
    };

    expect(parseStoredLayout(JSON.stringify(stored))).toEqual(stored);
  });

  it("descarta solo los campos con forma inválida, conserva el resto", () => {
    const raw = JSON.stringify({
      columnOrder: ["ticker", 42], // inválido: no todos strings
      columnSizing: { ticker: 200 },
      columnVisibility: "no-es-un-objeto", // inválido
      sorting: [{ id: "ticker", desc: false }],
    });

    expect(parseStoredLayout(raw)).toEqual({
      columnSizing: { ticker: 200 },
      sorting: [{ id: "ticker", desc: false }],
    });
  });

  it("descarta una entrada de sorting con forma inválida", () => {
    const raw = JSON.stringify({
      sorting: [{ id: "ticker" }, { id: "price", desc: true }],
    });

    expect(parseStoredLayout(raw)).toEqual({});
  });
});

describe("reconcileColumnOrder", () => {
  const defaultOrder = ["ticker", "price", "value"];

  it("conserva el orden guardado cuando coincide con las columnas actuales", () => {
    expect(reconcileColumnOrder(defaultOrder, ["value", "ticker", "price"])).toEqual([
      "value",
      "ticker",
      "price",
    ]);
  });

  it("descarta columnas guardadas que ya no existen", () => {
    expect(reconcileColumnOrder(defaultOrder, ["price", "obsoleta", "ticker"])).toEqual([
      "price",
      "ticker",
      "value",
    ]);
  });

  it("agrega al final las columnas nuevas que el layout guardado no conocía", () => {
    expect(reconcileColumnOrder(defaultOrder, ["price"])).toEqual(["price", "ticker", "value"]);
  });

  it("devuelve el orden por defecto cuando no hay nada guardado", () => {
    expect(reconcileColumnOrder(defaultOrder, [])).toEqual(defaultOrder);
  });
});

describe("serializeLayout", () => {
  it("hace roundtrip con parseStoredLayout", () => {
    const layout: PositionsTableLayout = {
      columnOrder: ["ticker"],
      columnSizing: {},
      columnVisibility: {},
      sorting: [],
    };

    expect(parseStoredLayout(serializeLayout(layout))).toEqual(layout);
  });
});
