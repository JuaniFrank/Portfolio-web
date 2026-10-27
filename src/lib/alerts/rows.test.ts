import { describe, expect, it } from "vitest";
import { buildTargetRows } from "./rows";
import type { AlertTarget } from "./types";

const base: AlertTarget & { instrumentName: string } = {
  id: "t1",
  userId: "u1",
  instrumentId: "i1",
  ticker: "KO",
  instrumentName: "Coca-Cola CEDEAR",
  symbol: "KO",
  currency: "USD",
  direction: "BELOW",
  targetPrice: 90,
  note: null,
  triggeredAt: null,
  triggeredPrice: null,
  notifiedAt: null,
};

describe("buildTargetRows", () => {
  it("arma estado y distancia con el precio actual del instrumento", () => {
    const [row] = buildTargetRows([base], new Map([["i1", 100]]));
    expect(row).toMatchObject({ id: "t1", price: 100, status: "armed" });
    expect(row?.distancePct).toBeCloseTo(-10);
  });

  it("un objetivo cumplido pero aún armado figura como alcanzado", () => {
    const [row] = buildTargetRows([base], new Map([["i1", 85]]));
    expect(row?.status).toBe("reached");
  });

  it("un objetivo disparado conserva el precio del disparo y la fecha en ISO", () => {
    const at = new Date("2026-10-26T15:00:00Z");
    const [row] = buildTargetRows(
      [{ ...base, triggeredAt: at, triggeredPrice: 88, notifiedAt: at }],
      new Map([["i1", 120]])
    );
    expect(row).toMatchObject({
      status: "triggered",
      triggeredAt: at.toISOString(),
      triggeredPrice: 88,
      notified: true,
    });
  });

  it("sin precio: estado armado y distancia nula", () => {
    const [row] = buildTargetRows([base], new Map());
    expect(row).toMatchObject({ price: null, distancePct: null, status: "armed" });
  });
});
