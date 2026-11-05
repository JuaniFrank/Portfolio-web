import { describe, expect, it } from "vitest";
import {
  DRAWING_POINTS_REQUIRED,
  drawingsStorageKey,
  parseDrawings,
  serializeDrawings,
} from "./drawings-storage";

describe("drawingsStorageKey", () => {
  it("is scoped by ticker and view", () => {
    expect(drawingsStorageKey("GGAL", "native")).not.toBe(drawingsStorageKey("GGAL", "cedear-underlying"));
    expect(drawingsStorageKey("GGAL", "native")).not.toBe(drawingsStorageKey("YPFD", "native"));
  });
  it("normalises ticker case", () => {
    expect(drawingsStorageKey("ggal", "native")).toBe(drawingsStorageKey("GGAL", "native"));
  });
});

describe("serializeDrawings / parseDrawings", () => {
  const segment = {
    name: "segment",
    points: [
      { timestamp: 1700000000000, value: 10 },
      { timestamp: 1700086400000, value: 12 },
    ],
  };

  it("round-trips a valid drawing", () => {
    expect(parseDrawings(serializeDrawings([segment]))).toEqual([segment]);
  });

  it("keeps annotation text", () => {
    const note = { name: "simpleAnnotation", points: [{ timestamp: 1, value: 2 }], text: "soporte" };
    expect(parseDrawings(serializeDrawings([note]))).toEqual([note]);
  });

  it("drops unknown tools and incomplete drawings when serializing", () => {
    const incomplete = { name: "segment", points: [{ timestamp: 1, value: 2 }] };
    const unknown = { name: "nope", points: [{ timestamp: 1, value: 2 }] };
    expect(parseDrawings(serializeDrawings([incomplete, unknown, segment]))).toEqual([segment]);
  });

  it("drops points with missing or non-finite coordinates", () => {
    const bad = { name: "priceLine", points: [{ timestamp: 1 }] };
    expect(parseDrawings(serializeDrawings([bad]))).toEqual([]);
  });

  it("requires the expected point count per tool", () => {
    expect(DRAWING_POINTS_REQUIRED.parallelStraightLine).toBe(3);
    expect(DRAWING_POINTS_REQUIRED.horizontalStraightLine).toBe(1);
  });

  it("parses garbage, null and wrong shapes as empty", () => {
    expect(parseDrawings(null)).toEqual([]);
    expect(parseDrawings("{not json")).toEqual([]);
    expect(parseDrawings(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseDrawings(JSON.stringify([null, 3, { name: "segment" }]))).toEqual([]);
  });

  it("never persists the ephemeral measure ruler", () => {
    const measure = { name: "measure", points: [{ timestamp: 1, value: 1 }, { timestamp: 2, value: 2 }] };
    expect(parseDrawings(serializeDrawings([measure]))).toEqual([]);
    expect(parseDrawings(JSON.stringify([measure]))).toEqual([]);
  });
});
