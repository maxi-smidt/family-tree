import { describe, expect, it } from "vitest";
import { ALL_VIEWS } from "./tabs";
import { filterViewsByRestrictions } from "./contentRestrictions";

describe("filterViewsByRestrictions", () => {
  it("hides Media only when both of its domains are restricted", () => {
    const sourcesRestricted = filterViewsByRestrictions(
      [...ALL_VIEWS],
      ["sources"],
    );
    const allMediaRestricted = filterViewsByRestrictions(
      [...ALL_VIEWS],
      ["gallery", "sources"],
    );

    expect(sourcesRestricted).toContain("media-view");
    expect(allMediaRestricted).not.toContain("media-view");
  });
});
