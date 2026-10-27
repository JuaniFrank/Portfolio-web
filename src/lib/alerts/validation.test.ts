import { describe, expect, it } from "vitest";
import { parseCreateTargetInput, parseUpdateTargetInput } from "./validation";

describe("parseCreateTargetInput", () => {
  it("acepta una entrada válida y normaliza la nota", () => {
    const result = parseCreateTargetInput({
      instrumentId: "i1",
      targetPrice: 92.5,
      direction: "BELOW",
      note: "  re-entrada  ",
    });
    expect(result).toEqual({
      ok: true,
      data: { instrumentId: "i1", targetPrice: 92.5, direction: "BELOW", note: "re-entrada" },
    });
  });

  it("una nota vacía o ausente queda en null", () => {
    const empty = parseCreateTargetInput({ instrumentId: "i1", targetPrice: 1, direction: "ABOVE", note: "   " });
    const absent = parseCreateTargetInput({ instrumentId: "i1", targetPrice: 1, direction: "ABOVE" });
    expect(empty.ok && empty.data.note).toBeNull();
    expect(absent.ok && absent.data.note).toBeNull();
  });

  it("acepta el precio como texto con coma decimal", () => {
    const result = parseCreateTargetInput({ instrumentId: "i1", targetPrice: "92,5", direction: "ABOVE" });
    expect(result.ok && result.data.targetPrice).toBe(92.5);
  });

  it("rechaza precios no positivos, no numéricos o infinitos", () => {
    for (const targetPrice of [0, -5, "abc", "", Number.NaN, Infinity]) {
      const result = parseCreateTargetInput({ instrumentId: "i1", targetPrice, direction: "ABOVE" });
      expect(result.ok).toBe(false);
    }
  });

  it("rechaza precios que no entran en Decimal(20,8)", () => {
    for (const targetPrice of [1e11, 1e15, "100000000000"]) {
      const result = parseCreateTargetInput({ instrumentId: "i1", targetPrice, direction: "ABOVE" });
      expect(result.ok).toBe(false);
    }
    const result = parseCreateTargetInput({ instrumentId: "i1", targetPrice: 99_999_999_999, direction: "ABOVE" });
    expect(result.ok).toBe(true);
  });

  it("rechaza dirección inválida e instrumento vacío", () => {
    expect(parseCreateTargetInput({ instrumentId: "i1", targetPrice: 1, direction: "SIDEWAYS" }).ok).toBe(false);
    expect(parseCreateTargetInput({ instrumentId: "", targetPrice: 1, direction: "ABOVE" }).ok).toBe(false);
  });

  it("rechaza una nota demasiado larga", () => {
    const result = parseCreateTargetInput({
      instrumentId: "i1",
      targetPrice: 1,
      direction: "ABOVE",
      note: "x".repeat(201),
    });
    expect(result.ok).toBe(false);
  });

  it("devuelve un mensaje de error legible", () => {
    const result = parseCreateTargetInput({ instrumentId: "i1", targetPrice: -1, direction: "ABOVE" });
    expect(!result.ok && result.error).toMatch(/precio/i);
  });
});

describe("parseUpdateTargetInput", () => {
  it("requiere el id del objetivo y no acepta cambiar de instrumento", () => {
    const result = parseUpdateTargetInput({ id: "t1", targetPrice: 10, direction: "ABOVE", note: null });
    expect(result).toEqual({
      ok: true,
      data: { id: "t1", targetPrice: 10, direction: "ABOVE", note: null },
    });
    expect(parseUpdateTargetInput({ targetPrice: 10, direction: "ABOVE" }).ok).toBe(false);
  });
});
