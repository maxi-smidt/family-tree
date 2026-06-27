import { describe, expect, it } from "vitest";
import {
  buildInitialResolutionState,
  buildPairKey,
  buildResolutionsPayload,
  getMemberField,
  isFieldConflicting,
  memberDisplayName,
} from "./mergeUtils";
import type { DuplicatePair } from "@/types/merge";
import type { MemberDB } from "@/types/member";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeDB = (overrides: Partial<MemberDB> = {}): MemberDB => ({
  id: "test-id",
  gender: "m",
  academicTitle: null,
  firstName: "John",
  lastName: "Doe",
  middleNames: null,
  baptismalName: null,
  maidenName: null,
  imageData: null,
  dateOfBirth: "1950",
  dateOfDeath: null,
  deceased: false,
  adopted: false,
  additionalData: null,
  birthplace: null,
  hometown: null,
  placesLived: null,
  isCollapsed: 0,
  positionX: 0,
  positionY: 0,
  ...overrides,
});

const makePair = (overrides: Partial<DuplicatePair> = {}): DuplicatePair => ({
  member_a: makeDB({ id: "a1", birthplace: "Berlin" }),
  member_b: makeDB({ id: "b1", birthplace: "Hamburg" }),
  match: "exact",
  conflicts: ["birthplace"],
  default_action: "merge",
  ...overrides,
});

// ---------------------------------------------------------------------------
// buildInitialResolutionState
// ---------------------------------------------------------------------------

describe("buildInitialResolutionState", () => {
  it("sets action from default_action", () => {
    const state = buildInitialResolutionState(
      makePair({ default_action: "keep_both" }),
    );
    expect(state.action).toBe("keep_both");
  });

  it("defaults each conflict field to 'a'", () => {
    const pair = makePair({ conflicts: ["birthplace", "additionalData"] });
    const state = buildInitialResolutionState(pair);
    expect(state.fields["birthplace"]).toBe("a");
    expect(state.fields["additionalData"]).toBe("a");
  });

  it("produces empty fields object when no conflicts", () => {
    const pair = makePair({ conflicts: [] });
    const state = buildInitialResolutionState(pair);
    expect(state.fields).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// buildPairKey
// ---------------------------------------------------------------------------

describe("buildPairKey", () => {
  it("is order-insensitive", () => {
    expect(buildPairKey("a1", "b1")).toBe(buildPairKey("b1", "a1"));
  });

  it("produces a stable string", () => {
    expect(buildPairKey("abc", "xyz")).toBe("abc|xyz");
  });
});

// ---------------------------------------------------------------------------
// buildResolutionsPayload
// ---------------------------------------------------------------------------

describe("buildResolutionsPayload", () => {
  it("maps pairs to resolution objects", () => {
    const pair = makePair();
    const states = new Map();
    states.set(buildPairKey("a1", "b1"), {
      action: "merge" as const,
      fields: { birthplace: "b" as const },
    });

    const result = buildResolutionsPayload([pair], states);
    expect(result).toHaveLength(1);
    expect(result[0].member_a_id).toBe("a1");
    expect(result[0].member_b_id).toBe("b1");
    expect(result[0].action).toBe("merge");
    expect(result[0].fields.birthplace).toBe("b");
  });

  it("strips fields when action is keep_both", () => {
    const pair = makePair({ default_action: "keep_both" });
    const states = new Map();
    states.set(buildPairKey("a1", "b1"), {
      action: "keep_both" as const,
      fields: { birthplace: "a" as const },
    });

    const result = buildResolutionsPayload([pair], states);
    expect(result[0].fields).toEqual({});
  });

  it("falls back to initial state when no entry in map", () => {
    const pair = makePair({
      default_action: "merge",
      conflicts: ["birthplace"],
    });
    const states = new Map(); // empty

    const result = buildResolutionsPayload([pair], states);
    expect(result[0].action).toBe("merge");
    expect(result[0].fields.birthplace).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// memberDisplayName
// ---------------------------------------------------------------------------

describe("memberDisplayName", () => {
  it("joins first and last name", () => {
    expect(
      memberDisplayName(makeDB({ firstName: "Jane", lastName: "Doe" })),
    ).toBe("Jane Doe");
  });

  it("falls back to (unknown) for empty names", () => {
    expect(memberDisplayName(makeDB({ firstName: "", lastName: "" }))).toBe(
      "(unknown)",
    );
  });
});

// ---------------------------------------------------------------------------
// getMemberField
// ---------------------------------------------------------------------------

describe("getMemberField", () => {
  it("returns a field value", () => {
    const m = makeDB({ birthplace: "Berlin" });
    expect(getMemberField(m, "birthplace")).toBe("Berlin");
  });

  it("returns null for missing field", () => {
    const m = makeDB({ birthplace: null });
    expect(getMemberField(m, "birthplace")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isFieldConflicting
// ---------------------------------------------------------------------------

describe("isFieldConflicting", () => {
  it("returns true when field is in conflicts list", () => {
    const pair = makePair({ conflicts: ["birthplace"] });
    expect(isFieldConflicting(pair, "birthplace")).toBe(true);
  });

  it("returns false when field is not in conflicts list", () => {
    const pair = makePair({ conflicts: ["birthplace"] });
    expect(isFieldConflicting(pair, "additionalData")).toBe(false);
  });
});
