import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDateWithFallback,
  formatPartialDateForInput,
  isValidPartialDate,
  parsePartialDateInput,
  resolveDateLocale,
  sortByDateDesc,
} from "@/utils/dateUtils";

describe("dateUtils", () => {
  it("formats date-only strings with the requested language locale", () => {
    expect(formatDate("2026-06-07", { language: "de" })).toBe("07.06.2026");
    expect(formatDate("2026-06-07", { language: "en" })).toBe("06/07/2026");
  });

  it("formats date and time through the same locale-aware path", () => {
    expect(
      formatDateTime("2026-06-07T16:20:13Z", {
        language: "de",
        timeZone: "UTC",
      }),
    ).toBe("07.06.2026, 16:20:13");
  });

  it("returns fallback or empty values for missing and invalid dates", () => {
    const t = (key: string) => key;

    expect(formatDate(null)).toBe("");
    expect(formatDate("not-a-date")).toBe("");
    expect(formatDateWithFallback(null, t)).toBe("common.date-unknown");
    expect(formatDateWithFallback("not-a-date", t)).toBe("common.date-unknown");
  });

  it("maps supported i18n languages to browser locales", () => {
    expect(resolveDateLocale("de-AT")).toBe("de-DE");
    expect(resolveDateLocale("en-US")).toBe("en-US");
    expect(resolveDateLocale("fr")).toBe("en-US");
  });

  describe("formatPartialDateForInput", () => {
    it("renders numeric, re-typeable strings in the locale field order", () => {
      expect(formatPartialDateForInput("2026-06-07", "de")).toBe("07.06.2026");
      expect(formatPartialDateForInput("2026-06-07", "en")).toBe("06/07/2026");
      expect(formatPartialDateForInput("2026-06", "de")).toBe("06.2026");
      expect(formatPartialDateForInput("2026-06", "en")).toBe("06/2026");
      expect(formatPartialDateForInput("2026", "de")).toBe("2026");
    });

    it("returns an empty string for missing or invalid values", () => {
      expect(formatPartialDateForInput(null)).toBe("");
      expect(formatPartialDateForInput("")).toBe("");
      expect(formatPartialDateForInput("not-a-date")).toBe("");
    });
  });

  describe("parsePartialDateInput", () => {
    it("treats empty input as a valid clear", () => {
      expect(parsePartialDateInput("")).toEqual({ value: null, valid: true });
      expect(parsePartialDateInput("   ")).toEqual({
        value: null,
        valid: true,
      });
    });

    it("parses full dates in the locale field order", () => {
      expect(parsePartialDateInput("07.06.2026", "de")).toEqual({
        value: "2026-06-07",
        valid: true,
      });
      expect(parsePartialDateInput("06/07/2026", "en")).toEqual({
        value: "2026-06-07",
        valid: true,
      });
    });

    it("parses ISO order regardless of locale", () => {
      expect(parsePartialDateInput("2026-06-07", "de")).toEqual({
        value: "2026-06-07",
        valid: true,
      });
    });

    it("parses partial precision (year, month + year)", () => {
      expect(parsePartialDateInput("2026", "en")).toEqual({
        value: "2026",
        valid: true,
      });
      expect(parsePartialDateInput("06.2026", "de")).toEqual({
        value: "2026-06",
        valid: true,
      });
      expect(parsePartialDateInput("06/2026", "en")).toEqual({
        value: "2026-06",
        valid: true,
      });
    });

    it("rejects malformed or out-of-range input", () => {
      expect(parsePartialDateInput("99").valid).toBe(false);
      expect(parsePartialDateInput("13/40/2026", "en").valid).toBe(false);
      expect(parsePartialDateInput("32.01.2026", "de").valid).toBe(false);
      expect(parsePartialDateInput("not a date").valid).toBe(false);
      expect(parsePartialDateInput("2026-13", "de").valid).toBe(false);
    });
  });

  describe("isValidPartialDate", () => {
    it("accepts valid partial dates", () => {
      expect(isValidPartialDate("2020")).toBe(true);
      expect(isValidPartialDate("2020-02")).toBe(true);
      expect(isValidPartialDate("2020-02-29")).toBe(true); // 2020 is a leap year
      expect(isValidPartialDate("2024-02-29")).toBe(true); // 2024 is a leap year
    });

    it("rejects impossible month or day values", () => {
      expect(isValidPartialDate("2020-13")).toBe(false); // month 13
      expect(isValidPartialDate("2020-00")).toBe(false); // month 0
      expect(isValidPartialDate("2020-02-30")).toBe(false); // Feb 30 doesn't exist
      expect(isValidPartialDate("2021-02-29")).toBe(false); // 2021 is not a leap year
      expect(isValidPartialDate("2020-04-31")).toBe(false); // April has 30 days
      expect(isValidPartialDate("not-a-date")).toBe(false);
      expect(isValidPartialDate("2020-00-00")).toBe(false); // month 0
    });
  });

  describe("sortByDateDesc", () => {
    it("orders items newest-first, handling partial precision", () => {
      const items = [
        { id: "day", date: "2020-06-15" },
        { id: "year", date: "2021" },
        { id: "month", date: "2020-08" },
      ];

      expect(sortByDateDesc(items, (i) => i.date).map((i) => i.id)).toEqual([
        "year",
        "month",
        "day",
      ]);
    });

    it("sorts undated items last", () => {
      const items = [
        { id: "undated", date: null },
        { id: "dated", date: "2020" },
      ];

      expect(sortByDateDesc(items, (i) => i.date).map((i) => i.id)).toEqual([
        "dated",
        "undated",
      ]);
    });

    it("does not mutate the input array", () => {
      const items = [
        { id: "a", date: "2020" },
        { id: "b", date: "2021" },
      ];
      const original = [...items];

      sortByDateDesc(items, (i) => i.date);

      expect(items).toEqual(original);
    });
  });
});
