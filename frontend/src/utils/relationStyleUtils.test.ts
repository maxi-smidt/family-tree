import { describe, expect, it } from "vitest";
import {
  applyRelationStyleOverride,
  getDefaultRelationEdgeStyle,
  resolveRelationStyle,
  toColorInputValue,
} from "@/utils/relationStyleUtils";

describe("relationStyleUtils", () => {
  it("resolves built-in relation defaults for picker display", () => {
    expect(resolveRelationStyle("married")).toMatchObject({
      stroke: "hsl(142 76% 36%)",
      strokeDasharray: "0",
      strokeWidth: 2,
      colorInput: "#16a34a",
    });
    expect(resolveRelationStyle("partner")).toMatchObject({
      strokeDasharray: "2,4",
      colorInput: "#3b82f6",
    });
  });

  it("uses overrides while preserving default fields that are not overridden", () => {
    expect(
      resolveRelationStyle("sibling", {
        color: "#123456",
        strokeDasharray: null,
        strokeWidth: 4,
      }),
    ).toMatchObject({
      stroke: "#123456",
      strokeDasharray: "0",
      strokeWidth: 4,
      colorInput: "#123456",
    });
  });

  it("keeps UI-only color input values out of edge styles", () => {
    expect(getDefaultRelationEdgeStyle("divorced")).toEqual({
      stroke: "var(--destructive)",
      strokeDasharray: "5,5",
      strokeWidth: 2,
    });
  });

  it("applies only non-null edge style overrides", () => {
    expect(
      applyRelationStyleOverride(
        { stroke: "blue", strokeDasharray: "5,5", strokeWidth: 2 },
        { color: null, strokeDasharray: "0", strokeWidth: null },
      ),
    ).toEqual({ stroke: "blue", strokeDasharray: "0", strokeWidth: 2 });
  });

  it("normalizes hex colors for native color inputs", () => {
    expect(toColorInputValue("#abc", "#000000")).toBe("#aabbcc");
    expect(toColorInputValue("var(--destructive)", "#dc2626")).toBe("#dc2626");
  });
});
