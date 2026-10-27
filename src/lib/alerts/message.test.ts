import { describe, expect, it } from "vitest";
import { formatAlertMessage } from "./message";
import type { AlertTarget } from "./types";

const base: AlertTarget = {
  id: "t1",
  userId: "u1",
  instrumentId: "i1",
  ticker: "KO",
  symbol: "KO",
  currency: "USD",
  direction: "BELOW",
  targetPrice: 92,
  note: null,
  triggeredAt: null,
  triggeredPrice: null,
  notifiedAt: null,
};

describe("formatAlertMessage", () => {
  it("formatea un objetivo en USD a la baja con formato es-AR", () => {
    const message = formatAlertMessage(base, 91.5);
    expect(message).toContain("Objetivo alcanzado: KO");
    expect(message).toContain("USD 91,50");
    expect(message).toContain("USD 92,00");
    expect(message).toContain("por debajo");
  });

  it("formatea un objetivo en ARS al alza con separador de miles", () => {
    const message = formatAlertMessage(
      { ...base, ticker: "GGAL", symbol: "GGAL", currency: "ARS", direction: "ABOVE", targetPrice: 7000 },
      7123.456
    );
    expect(message).toContain("Objetivo alcanzado: GGAL");
    expect(message).toContain("ARS 7.123,46");
    expect(message).toContain("ARS 7.000,00");
    expect(message).toContain("por encima");
  });

  it("aclara el símbolo de la acción original cuando difiere del ticker (CEDEAR)", () => {
    const message = formatAlertMessage({ ...base, ticker: "KO", symbol: "KO-X" }, 91);
    expect(message).toContain("KO-X");
  });

  it("incluye la nota solo si existe", () => {
    expect(formatAlertMessage(base, 91)).not.toContain("Nota");
    expect(formatAlertMessage({ ...base, note: "re-entrada" }, 91)).toContain("Nota: re-entrada");
  });
});
