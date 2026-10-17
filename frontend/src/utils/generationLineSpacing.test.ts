import { describe, expect, it } from "vitest";
import { createMember, Member } from "@/types/member";
import { getLayoutedElements } from "@/utils/layoutUtils";
import { GENERATION_ROW_PITCH } from "@/utils/generationLineSpacing";

describe("GENERATION_ROW_PITCH", () => {
  it("matches the row pitch the auto-layout produces", () => {
    const member = (id: string, parentId: string | null): Member => ({
      ...createMember({ x: 0, y: 0 }),
      id,
      parents: { paternalParent: parentId, maternalParent: null },
    });
    const positions = getLayoutedElements([
      member("grandparent", null),
      member("parent", "grandparent"),
      member("child", "parent"),
    ]);

    expect(positions.parent.y - positions.grandparent.y).toBe(
      GENERATION_ROW_PITCH,
    );
    expect(positions.child.y - positions.parent.y).toBe(GENERATION_ROW_PITCH);
  });
});
