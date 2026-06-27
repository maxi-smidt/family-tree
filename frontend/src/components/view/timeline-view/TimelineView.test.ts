import { describe, it, expect } from "vitest";
import { comparePartialDates } from "@/utils/dateUtils";

/**
 * The timeline sorts items using `comparePartialDates(b.date, a.date)` (descending).
 * These tests verify that partial-date strings sort into the correct chronological
 * order (newest first) when mixed precisions are present.
 */
describe("timeline sort: comparePartialDates descending", () => {
  function sortDesc(dates: string[]): string[] {
    return [...dates].sort((a, b) => comparePartialDates(b, a));
  }

  it("sorts year-only, month+year, and full-date strings newest-first", () => {
    const input = [
      "1920",
      "2010-06-15",
      "2010-06",
      "1995-03",
      "2024-01-01",
    ];
    expect(sortDesc(input)).toEqual([
      "2024-01-01",
      "2010-06-15",
      "2010-06",
      "1995-03",
      "1920",
    ]);
  });

  it("places a year-only date before the same year's month or full date", () => {
    // "2000" < "2000-01" lexicographically, so in descending order
    // "2000-12" comes first, then "2000-01", then "2000"
    const input = ["2000", "2000-01", "2000-12"];
    expect(sortDesc(input)).toEqual(["2000-12", "2000-01", "2000"]);
  });

  it("handles nulls — null dates sort last (oldest)", () => {
    const input = ["2020", null as unknown as string, "1990"];
    expect(sortDesc(input)).toEqual(["2020", "1990", null]);
  });
});
