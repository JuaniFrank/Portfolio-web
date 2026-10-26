import { describe, expect, it } from "vitest";
import { computeFxDailyChange } from "@/lib/market/fx-daily-change";
import { EMPTY_FX_RATES, toFxRateView } from "./fx-rates";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("toFxRateView", () => {
  it("serializa valores y fecha del cierre previo para el cliente", () => {
    const view = toFxRateView(computeFxDailyChange(1681.1, { date: utc("2026-10-25"), mid: 1651.6 }));

    expect(view).toEqual({
      mid: "1681.10",
      previousMid: "1651.60",
      previousDate: "2026-10-25",
      changeArs: "29.50",
      changePct: "1.79",
    });
  });

  it("deja en null lo que no se pudo calcular", () => {
    const view = toFxRateView(computeFxDailyChange(1681.1, null));

    expect(view).toEqual({
      mid: "1681.10",
      previousMid: null,
      previousDate: null,
      changeArs: null,
      changePct: null,
    });
  });

  it("devuelve null cuando no hay cotización", () => {
    expect(toFxRateView(null)).toBeNull();
  });

  it("EMPTY_FX_RATES no trae ninguna cotización", () => {
    expect(EMPTY_FX_RATES).toEqual({ ccl: null, mep: null });
  });
});
