import { describe, expect, it } from "vitest";
import { isEchoLiveSnapshot } from "./echo-live-snapshot";

const AAPL = "inst-aapl";
const GGAL = "inst-ggal";

describe("isEchoLiveSnapshot", () => {
  it("todas las cotizaciones en vivo igualan su cierre anterior → echo", () => {
    const result = isEchoLiveSnapshot(
      [
        { instrumentId: AAPL, price: 100 },
        { instrumentId: GGAL, price: 50 },
      ],
      new Map([
        [AAPL, 100],
        [GGAL, 50],
      ])
    );
    expect(result).toBe(true);
  });

  it("una sola cotización distinta alcanza para no ser echo", () => {
    const result = isEchoLiveSnapshot(
      [
        { instrumentId: AAPL, price: 100 },
        { instrumentId: GGAL, price: 51 },
      ],
      new Map([
        [AAPL, 100],
        [GGAL, 50],
      ])
    );
    expect(result).toBe(false);
  });

  it("un instrumento sin cierre anterior con qué comparar → no es echo (conservador)", () => {
    const result = isEchoLiveSnapshot(
      [{ instrumentId: AAPL, price: 100 }],
      new Map() // sin entrada para AAPL
    );
    expect(result).toBe(false);
  });

  it("sin cotizaciones en vivo → no es echo (no hay overlay que omitir)", () => {
    const result = isEchoLiveSnapshot([], new Map([[AAPL, 100]]));
    expect(result).toBe(false);
  });

  it("ignora cotizaciones no utilizables (null/0/negativas) al decidir", () => {
    // Si la única cotización "usable" iguala su cierre anterior, sigue siendo echo.
    const result = isEchoLiveSnapshot(
      [
        { instrumentId: AAPL, price: 100 },
        { instrumentId: GGAL, price: null },
      ],
      new Map([[AAPL, 100]])
    );
    expect(result).toBe(true);
  });

  it("respeta una diferencia menor al epsilon como echo", () => {
    const result = isEchoLiveSnapshot(
      [{ instrumentId: AAPL, price: 100.0000000001 }],
      new Map([[AAPL, 100]]),
      1e-6
    );
    expect(result).toBe(true);
  });

  it("una diferencia mayor al epsilon no es echo", () => {
    const result = isEchoLiveSnapshot(
      [{ instrumentId: AAPL, price: 100.01 }],
      new Map([[AAPL, 100]]),
      1e-6
    );
    expect(result).toBe(false);
  });
});
