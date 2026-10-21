import { describe, expect, it } from "vitest";
import { ALL_REPORTS_TAG, reportTagsFor, userReportTag } from "./report-tags";

describe("report cache tags", () => {
  it("scopes the user tag by user id", () => {
    expect(userReportTag("u1")).toBe("reports:user:u1");
    expect(userReportTag("u1")).not.toBe(userReportTag("u2"));
  });

  it("tags every cached report with its user tag and the global tag", () => {
    expect(reportTagsFor("u1")).toEqual(["reports:user:u1", ALL_REPORTS_TAG]);
  });

  it("keeps tags within the 256 character limit", () => {
    expect(userReportTag("c".repeat(30)).length).toBeLessThan(256);
  });
});
