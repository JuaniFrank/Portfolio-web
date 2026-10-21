import { describe, expect, it } from "vitest";
import {
  compareNullableAlphabetical,
  compareNullableNumeric,
  fitColumnWidth,
  parseStoredLayout,
  reconcileColumnOrder,
  resolveColumnWidths,
  serializeLayout,
  type ColumnWidthSpec,
  type PositionsTableLayout,
} from "./positions-table-layout";

const TICKER: ColumnWidthSpec = { id: "ticker", size: 180, minSize: 120 };
const COST: ColumnWidthSpec = { id: "cost", size: 150, minSize: 110 };
const PRICE: ColumnWidthSpec = { id: "price", size: 115, minSize: 90, maxSize: 200 };
const SPECS = [TICKER, COST, PRICE];

describe("resolveColumnWidths", () => {
  it("usa el tamaño por defecto cuando no hay ancho guardado", () => {
    const result = resolveColumnWidths(SPECS, ["ticker", "cost", "price"], {}, {});
    expect(result.columns).toEqual([
      { id: "ticker", width: 180 },
      { id: "cost", width: 150 },
      { id: "price", width: 115 },
    ]);
    expect(result.total).toBe(445);
  });

  it("cambiar el ancho de una columna no toca a las demás y el total es la suma", () => {
    const before = resolveColumnWidths(SPECS, ["ticker", "cost", "price"], {}, {});
    const after = resolveColumnWidths(SPECS, ["ticker", "cost", "price"], {}, { cost: 230 });
    expect(after.columns).toEqual([
      { id: "ticker", width: 180 },
      { id: "cost", width: 230 },
      { id: "price", width: 115 },
    ]);
    expect(after.total).toBe(before.total + 80);
  });

  it("respeta el orden visible y excluye las columnas ocultas del total", () => {
    const result = resolveColumnWidths(SPECS, ["price", "ticker", "cost"], { cost: false }, {});
    expect(result.columns.map((column) => column.id)).toEqual(["price", "ticker"]);
    expect(result.total).toBe(295);
  });

  it("acota el ancho guardado entre el mínimo y el máximo", () => {
    const result = resolveColumnWidths(
      SPECS,
      ["ticker", "cost", "price"],
      {},
      { ticker: 40, price: 900 }
    );
    expect(result.columns).toEqual([
      { id: "ticker", width: 120 },
      { id: "cost", width: 150 },
      { id: "price", width: 200 },
    ]);
  });

  it("ignora ids del orden que no tienen configuración", () => {
    const result = resolveColumnWidths(SPECS, ["ticker", "removed", "cost", "price"], {}, {});
    expect(result.columns.map((column) => column.id)).toEqual(["ticker", "cost", "price"]);
  });

  it("descarta anchos guardados no finitos", () => {
    const result = resolveColumnWidths(SPECS, ["ticker"], {}, { ticker: Number.NaN });
    expect(result.columns).toEqual([{ id: "ticker", width: 180 }]);
  });
});

describe("fitColumnWidth", () => {
  it("toma el contenido más ancho, redondeado hacia arriba", () => {
    expect(fitColumnWidth([96.2, 131.4, 88], COST)).toBe(132);
  });

  it("no baja del mínimo ni pasa el máximo", () => {
    expect(fitColumnWidth([40], COST)).toBe(110);
    expect(fitColumnWidth([480], PRICE)).toBe(200);
  });

  it("sin mediciones vuelve al tamaño por defecto", () => {
    expect(fitColumnWidth([], TICKER)).toBe(180);
  });
});

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
