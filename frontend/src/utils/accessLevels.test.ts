import { describe, expect, it } from "vitest";
import {
  ACCESS_PRESETS,
  canEditArea,
  levelsOf,
  presetOf,
} from "./accessLevels";

describe("access levels", () => {
  it("derives levels from role, hidden and read-only areas", () => {
    expect(
      levelsOf({
        role: "editor",
        restrictions: ["diseases"],
        read_only: ["gallery", "sources", "events", "tasks"],
      }),
    ).toEqual(ACCESS_PRESETS.contributor);
    expect(
      levelsOf({ role: "viewer", restrictions: ["diseases"], read_only: [] })
        .tree,
    ).toBe("view");
  });

  it("recognizes presets and custom mixes", () => {
    expect(presetOf(ACCESS_PRESETS["tree-only"])).toBe("tree-only");
    expect(presetOf({ ...ACCESS_PRESETS.editor, gallery: "view" })).toBeNull();
  });

  it("checks whether an area is editable", () => {
    const tree = {
      id: "w",
      name: "W",
      role: "editor" as const,
      restrictions: ["diseases"],
      read_only: ["gallery"],
    };
    expect(canEditArea(tree, "tree")).toBe(true);
    expect(canEditArea(tree, "gallery")).toBe(false);
    expect(canEditArea(tree, "diseases")).toBe(false);
    expect(canEditArea({ ...tree, role: "viewer" }, "tree")).toBe(false);
    expect(canEditArea({ ...tree, role: "owner" }, "gallery")).toBe(true);
  });
});
