import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatDateWithFallback,
  resolveDateLocale,
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
});
