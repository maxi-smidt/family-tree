import { beforeEach, describe, expect, it } from "vitest";
import { useFamilyTreeSettings } from "./useFamilyTreeSettings";

describe("useFamilyTreeSettings", () => {
  beforeEach(() => {
    useFamilyTreeSettings.setState({ generationLineGaps: {} });
  });

  it("stores generation-line spacing separately for each tree", () => {
    const { setGenerationLineGap } = useFamilyTreeSettings.getState();

    setGenerationLineGap("tree-one", 250);
    setGenerationLineGap("tree-two", null);

    expect(useFamilyTreeSettings.getState().generationLineGaps).toEqual({
      "tree-one": 250,
      "tree-two": null,
    });
  });

  it("rejects spacing values outside the snap-constrained choices", () => {
    useFamilyTreeSettings.getState().setGenerationLineGap("tree-one", 510);

    expect(useFamilyTreeSettings.getState().generationLineGaps).toEqual({});
  });
});
