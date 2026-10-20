import { describe, expect, it } from "vitest";
import {
  PREVIEW_FOCUS_ID,
  previewSectionMembers,
  previewSectionBoundaryMembers,
  previewViewMembers,
} from "./treePreview";

const view = (
  up: number,
  down: number,
  includePartners = true,
  sectionScoped = false,
) => previewViewMembers({ up, down, includePartners, sectionScoped });

describe("previewViewMembers", () => {
  it("always includes the focus", () => {
    expect(view(0, 0, false)).toEqual(new Set([PREVIEW_FOCUS_ID]));
  });

  it("follows straight lines up and down for the whole workspace", () => {
    const ids = view(1, 1, false);
    expect(ids).toEqual(
      new Set([PREVIEW_FOCUS_ID, "father", "mother", "child1", "child2"]),
    );
  });

  it("adds partners of included people when partners are on", () => {
    const ids = view(1, 1);
    expect(ids.has("partner")).toBe(true);
    expect(ids.has("child-partner")).toBe(true);
    expect(ids.has("uncle")).toBe(false);
  });

  it("lights up the generations past the drawn ones only when all the way", () => {
    expect(view(2, 2).has("more-up")).toBe(false);
    expect(view(Infinity, 2).has("more-up")).toBe(true);
    expect(view(2, Infinity).has("more-down")).toBe(true);
  });

  it("walks the whole family inside the sections, within the band", () => {
    const ids = view(2, 0, false, true);
    expect(ids.has("uncle")).toBe(true);
    expect(ids.has("cousin")).toBe(true);
    expect(ids.has("sibling")).toBe(true);
    expect(ids.has("child1")).toBe(false);
  });

  it("never includes people outside the sections", () => {
    const ids = view(Infinity, Infinity, true, true);
    expect(ids.has("in-law1")).toBe(false);
    expect(ids.has("in-law2")).toBe(false);
  });
});

describe("previewSectionMembers", () => {
  it("includes collateral relatives, their descendants and their partners in extended family", () => {
    const included = previewSectionMembers("extended_family");
    for (const id of [
      PREVIEW_FOCUS_ID,
      "gp1",
      "gp2",
      "gp3",
      "gp4",
      "father",
      "mother",
      "sibling",
      "uncle",
      "uncle-partner",
      "cousin",
      "partner",
      "child1",
      "child2",
      "child-partner",
      "grandchild",
    ])
      expect(included.has(id), id).toBe(true);
  });

  it("adds extended-family partners without following the partners' own branches", () => {
    const included = previewSectionMembers("extended_family");
    expect(included.has("in-law1")).toBe(false);
    expect(included.has("in-law2")).toBe(false);
    expect(previewSectionBoundaryMembers(included)).toEqual(
      new Set(["in-law1", "in-law2"]),
    );
  });

  it("includes the source's direct ancestors, descendants and own partner", () => {
    expect(previewSectionMembers("lineage")).toEqual(
      new Set([
        PREVIEW_FOCUS_ID,
        "father",
        "mother",
        "gp1",
        "gp2",
        "gp3",
        "gp4",
        "more-up",
        "child1",
        "child2",
        "grandchild",
        "more-down",
        "partner",
      ]),
    );
  });

  it("keeps collateral relatives and other people's partners as outside context", () => {
    const included = previewSectionMembers("lineage");
    expect(previewSectionBoundaryMembers(included)).toEqual(
      new Set(["uncle", "sibling", "in-law1", "in-law2", "child-partner"]),
    );
    expect(included.has("cousin")).toBe(false);
  });

  it("takes the family of origin for direct family", () => {
    const ids = previewSectionMembers("direct_family");
    for (const id of ["father", "mother", "gp1", "uncle", "cousin", "sibling"])
      expect(ids.has(id)).toBe(true);
    expect(ids.has("partner")).toBe(false);
    expect(ids.has("child1")).toBe(false);
    expect(ids.has(PREVIEW_FOCUS_ID)).toBe(true);
  });

  it("takes the partner's side and the shared children for partnership", () => {
    const ids = previewSectionMembers("partnership");
    for (const id of ["partner", "in-law1", "child1", "grandchild"])
      expect(ids.has(id)).toBe(true);
    expect(ids.has("father")).toBe(false);
  });

  it("keeps the seed's partner and children outside family-of-origin membership", () => {
    const included = previewSectionMembers("direct_family");
    expect(previewSectionBoundaryMembers(included)).toEqual(
      new Set(["partner", "child1", "child2"]),
    );
  });

  it("keeps the seed's parents outside partner-side membership", () => {
    const included = previewSectionMembers("partnership");
    expect(previewSectionBoundaryMembers(included)).toEqual(
      new Set(["father", "mother"]),
    );
  });
});
