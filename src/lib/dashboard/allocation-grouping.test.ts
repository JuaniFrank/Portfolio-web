import { describe, expect, it } from "vitest";
import { REST_SLICE_KEY, groupAllocationSlices } from "./allocation-grouping";
import type { AllocationSlice } from "./types";

const slice = (key: string, valueArs: number, percent: number): AllocationSlice => ({
  key,
  label: key,
  valueArs: valueArs.toFixed(2),
  valueUsd: (valueArs / 1000).toFixed(2),
  percent: percent.toFixed(2),
});

describe("groupAllocationSlices", () => {
  it("returns the data untouched when there is no topN or it fits", () => {
    const data = [slice("A", 100, 50), slice("B", 100, 50)];
    expect(groupAllocationSlices(data)).toEqual(data);
    expect(groupAllocationSlices(data, 2)).toEqual(data);
  });

  it("groups the tail as 'Otros' and lists the grouped tickers as details", () => {
    const data = [
      slice("A", 500, 50),
      slice("B", 300, 30),
      slice("C", 150, 15),
      slice("D", 50, 5),
    ];

    const result = groupAllocationSlices(data, 2);

    expect(result.map((s) => s.key)).toEqual(["A", "B", REST_SLICE_KEY]);
    const rest = result[2]!;
    expect(rest.label).toBe("Otros");
    expect(rest.valueArs).toBe("200.00");
    expect(rest.valueUsd).toBe("0.20");
    expect(rest.percent).toBe("20.00");
    expect(rest.details).toEqual([
      { key: "C", label: "C", valueArs: "150.00", valueUsd: "0.15", percent: "15.00" },
      { key: "D", label: "D", valueArs: "50.00", valueUsd: "0.05", percent: "5.00" },
    ]);
  });

  it("keeps slices that already carry details out of the rest bucket", () => {
    const on: AllocationSlice = {
      ...slice("ON", 10, 1),
      details: [{ key: "X", label: "X", valueArs: "10", valueUsd: "0.01", percent: "1" }],
    };
    const data = [slice("A", 500, 50), slice("B", 300, 30), on, slice("C", 190, 19)];

    const result = groupAllocationSlices(data, 2);

    expect(result.map((s) => s.key)).toEqual(["ON", "A", REST_SLICE_KEY]);
    expect(result[2]!.details?.map((d) => d.key)).toEqual(["B", "C"]);
  });
});
