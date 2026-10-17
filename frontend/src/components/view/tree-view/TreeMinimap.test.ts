import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import { minimapNodeColor } from "@/components/view/tree-view/TreeMinimap";

const node = (type: string, gender?: string): Node => ({
  id: "n",
  type,
  position: { x: 0, y: 0 },
  data: { gender },
});

describe("minimapNodeColor", () => {
  it("colours people by gender", () => {
    expect(minimapNodeColor(node("familyMember", "m"))).toBe("var(--gender-m)");
    expect(minimapNodeColor(node("familyMember", "f"))).toBe("var(--gender-f)");
    expect(minimapNodeColor(node("familyMember", "o"))).toBe("var(--gender-o)");
  });

  it("hides union knots", () => {
    expect(minimapNodeColor(node("unionNode"))).toBe("transparent");
  });
});
