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
  academic_title: null,
  first_name: "John",
  last_name: "Doe",
  middle_names: null,
  baptismal_name: null,
  maiden_name: null,
  image_data: null,
  date_of_birth: "1950",
  date_of_death: null,
  deceased: false,
  additional_data: null,
  birthplace: null,
  hometown: null,
  places_lived: null,
  is_collapsed: 0,
  position_x: 0,
  position_y: 0,
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
    const pair = makePair({ conflicts: ["birthplace", "additional_data"] });
    const state = buildInitialResolutionState(pair);
    expect(state.fields["birthplace"]).toBe("a");
    expect(state.fields["additional_data"]).toBe("a");
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
      memberDisplayName(makeDB({ first_name: "Jane", last_name: "Doe" })),
    ).toBe("Jane Doe");
  });

  it("falls back to (unknown) for empty names", () => {
    expect(memberDisplayName(makeDB({ first_name: "", last_name: "" }))).toBe(
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
    expect(isFieldConflicting(pair, "additional_data")).toBe(false);
  });
});
