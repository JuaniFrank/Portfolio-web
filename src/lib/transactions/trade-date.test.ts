import { describe, expect, it } from "vitest";
import { localTodayIso, tradeDateToInput, tradeDateToStorage } from "./trade-date";

describe("tradeDateToStorage", () => {
  it("stores a calendar day at 12:00Z, the same convention as imports", () => {
    expect(tradeDateToStorage("2026-03-05").toISOString()).toBe("2026-03-05T12:00:00.000Z");
  });

  it("sorts after midnight-stored rows and before the next day of the same import", () => {
    const manual = tradeDateToStorage("2026-03-05").getTime();
    const importedBuy = new Date("2026-03-05T12:00:00.000Z").getTime();
    expect(manual).toBe(importedBuy);
  });
});

describe("tradeDateToInput", () => {
  it("round-trips a stored day regardless of the viewer's timezone", () => {
    const stored = tradeDateToStorage("2026-03-05");
    expect(tradeDateToInput(stored)).toBe("2026-03-05");
  });

  it("still reads legacy 00:00Z rows as their own day", () => {
    expect(tradeDateToInput(new Date("2026-03-05T00:00:00.000Z"))).toBe("2026-03-05");
  });
});

describe("localTodayIso", () => {
  it("uses the local calendar day, not the UTC one", () => {
    // 22:30 local on the 5th in UTC-3 is already the 6th in UTC.
    const now = new Date(2026, 2, 5, 22, 30);
    expect(localTodayIso(now)).toBe("2026-03-05");
  });

  it("zero-pads month and day", () => {
    expect(localTodayIso(new Date(2026, 0, 2, 9, 0))).toBe("2026-01-02");
  });
});
