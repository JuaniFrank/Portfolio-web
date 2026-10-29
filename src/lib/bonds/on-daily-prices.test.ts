import { describe, expect, it } from "vitest";
import { TimeSeries } from "@/lib/rendimientos/price-series";
import { buildOnDailyPrices, type OnTermsRow } from "./on-daily-prices";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ms = (iso: string) => utc(iso).getTime();

const ccl = new TimeSeries([{ date: utc("2026-01-01"), value: 1000 }]);
const today = utc("2026-02-10");

const termsRow = (overrides: Partial<OnTermsRow> = {}): OnTermsRow => ({
  id: "on-1",
  bondTerms: null,
  bondSchedule: null,
  ...overrides,
});

describe("buildOnDailyPrices", () => {
  it("usa el snapshot real de data912 (ARS por 100 VN) y no marca el día como estimado", () => {
    const result = buildOnDailyPrices({
      instrumentIds: ["on-1"],
      snapshotRows: [
        { instrumentId: "on-1", datetime: new Date("2026-02-05T14:00:00.000Z"), close: 160100 },
      ],
      termsRows: [termsRow()],
      tradingDays: [utc("2026-02-05")],
      ccl,
      today,
    });

    expect(result.priceRows).toEqual([
      { instrumentId: "on-1", date: utc("2026-02-05"), close: 1601 },
    ]);
    expect(result.estimatedPriceDays.size).toBe(0);
  });

  it("acepta el close como Decimal-like (toNumber)", () => {
    const result = buildOnDailyPrices({
      instrumentIds: ["on-1"],
      snapshotRows: [
        {
          instrumentId: "on-1",
          datetime: new Date("2026-02-05T14:00:00.000Z"),
          close: { toNumber: () => 150000 },
        },
      ],
      termsRows: [termsRow()],
      tradingDays: [utc("2026-02-05")],
      ccl,
      today,
    });

    expect(result.priceRows[0]!.close).toBe(1500);
  });

  it("sin snapshot estima con valor técnico (par × CCL) y marca el día en estimatedPriceDays", () => {
    const result = buildOnDailyPrices({
      instrumentIds: ["on-1"],
      snapshotRows: [],
      termsRows: [termsRow()],
      tradingDays: [utc("2026-02-05"), utc("2026-02-06")],
      ccl,
      today,
    });

    expect(result.priceRows.map((row) => row.close)).toEqual([1000, 1000]);
    expect(result.estimatedPriceDays.get("on-1")).toEqual(
      new Set([ms("2026-02-05"), ms("2026-02-06")])
    );
  });

  it("usa el residual del BondSchedule guardado para estimar", () => {
    const result = buildOnDailyPrices({
      instrumentIds: ["on-1"],
      snapshotRows: [],
      termsRows: [
        termsRow({
          bondSchedule: {
            rows: [
              {
                paymentDate: "2026-01-15",
                capital: 30,
                interestRate: 0,
                interestAmount: 0,
                residualValue: 70,
                cashFlow: 30,
              },
            ],
          },
        }),
      ],
      tradingDays: [utc("2026-02-05")],
      ccl,
      today,
    });

    expect(result.priceRows[0]!.close).toBe(700);
  });

  it("mezcla real y estimado en el mismo instrumento y solo marca los estimados", () => {
    const result = buildOnDailyPrices({
      instrumentIds: ["on-1"],
      snapshotRows: [
        { instrumentId: "on-1", datetime: new Date("2026-02-06T14:00:00.000Z"), close: 120000 },
      ],
      termsRows: [termsRow()],
      tradingDays: [utc("2026-02-05"), utc("2026-02-06")],
      ccl,
      today,
    });

    expect(result.priceRows.map((row) => row.close)).toEqual([1000, 1200]);
    expect(result.estimatedPriceDays.get("on-1")).toEqual(new Set([ms("2026-02-05")]));
  });

  it("separa los snapshots por instrumento", () => {
    const result = buildOnDailyPrices({
      instrumentIds: ["on-1", "on-2"],
      snapshotRows: [
        { instrumentId: "on-1", datetime: new Date("2026-02-05T14:00:00.000Z"), close: 110000 },
        { instrumentId: "on-2", datetime: new Date("2026-02-05T14:00:00.000Z"), close: 90000 },
      ],
      termsRows: [termsRow({ id: "on-1" }), termsRow({ id: "on-2" })],
      tradingDays: [utc("2026-02-05")],
      ccl,
      today,
    });

    expect(result.priceRows).toEqual([
      { instrumentId: "on-1", date: utc("2026-02-05"), close: 1100 },
      { instrumentId: "on-2", date: utc("2026-02-05"), close: 900 },
    ]);
  });

  it("sin instrumentos devuelve vacío", () => {
    const result = buildOnDailyPrices({
      instrumentIds: [],
      snapshotRows: [],
      termsRows: [],
      tradingDays: [utc("2026-02-05")],
      ccl,
      today,
    });

    expect(result.priceRows).toEqual([]);
    expect(result.estimatedPriceDays.size).toBe(0);
  });
});
