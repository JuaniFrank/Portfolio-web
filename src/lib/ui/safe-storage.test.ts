import { describe, expect, it } from "vitest";
import { readStoredBoolean, readStoredString, writeStoredString } from "./safe-storage";

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
};
const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("safe-storage", () => {
  it("reads and writes strings", () => {
    const s = memory();
    expect(writeStoredString(s, "k", "v")).toBe(true);
    expect(readStoredString(s, "k")).toBe("v");
  });
  it("never throws when storage is blocked", () => {
    expect(readStoredString(throwing, "k")).toBeNull();
    expect(writeStoredString(throwing, "k", "v")).toBe(false);
  });
  it("tolerates a missing storage", () => {
    expect(readStoredString(null, "k")).toBeNull();
    expect(writeStoredString(null, "k", "v")).toBe(false);
  });
  it("parses booleans with a fallback", () => {
    expect(readStoredBoolean(memory({ k: "1" }), "k", false)).toBe(true);
    expect(readStoredBoolean(memory({ k: "0" }), "k", true)).toBe(false);
    expect(readStoredBoolean(memory({ k: "x" }), "k", true)).toBe(true);
    expect(readStoredBoolean(memory(), "k", false)).toBe(false);
    expect(readStoredBoolean(throwing, "k", true)).toBe(true);
  });
});
