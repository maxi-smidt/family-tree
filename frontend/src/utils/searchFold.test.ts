import { describe, expect, it } from "vitest";
import { foldForSearch } from "@/utils/searchFold";

describe("foldForSearch", () => {
  it("folds umlauts, ß and accents like the backend", () => {
    expect(foldForSearch("Müller")).toBe("mueller");
    expect(foldForSearch("Mueller")).toBe("mueller");
    expect(foldForSearch("Straße")).toBe("strasse");
    expect(foldForSearch("Šťastný Łódź Ærø")).toBe("stastny lodz aero");
  });
});
