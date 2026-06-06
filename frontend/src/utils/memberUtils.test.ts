import { describe, expect, it } from "vitest";
import { reconstructParents } from "./memberUtils";

const genders = (entries: Record<string, string>) =>
  new Map(Object.entries(entries));

const rels = (...ids: string[]) =>
  ids.map((to_member_id) => ({ to_member_id }));

describe("reconstructParents", () => {
  it("places a male parent in the paternal slot and a female in the maternal", () => {
    const slots = reconstructParents(
      rels("dad", "mom"),
      genders({ dad: "m", mom: "f" }),
    );
    expect(slots).toEqual({ paternalParent: "dad", maternalParent: "mom" });
  });

  it("is independent of relation order for gendered parents", () => {
    const slots = reconstructParents(
      rels("mom", "dad"),
      genders({ dad: "m", mom: "f" }),
    );
    expect(slots).toEqual({ paternalParent: "dad", maternalParent: "mom" });
  });

  it("does not let a gendered parent evict an unknown-gender one (regression)", () => {
    // "o" parent first, then a male parent — the male must not overwrite the
    // tentatively-placed "o" parent and drop it entirely.
    const slots = reconstructParents(
      rels("other", "dad"),
      genders({ other: "o", dad: "m" }),
    );
    expect(slots.paternalParent).toBe("dad");
    expect(slots.maternalParent).toBe("other");
    // Same data, reversed order, must give the same outcome.
    const reversed = reconstructParents(
      rels("dad", "other"),
      genders({ other: "o", dad: "m" }),
    );
    expect(reversed).toEqual(slots);
  });

  it("keeps both parents when they share a gender (regression)", () => {
    const slots = reconstructParents(
      rels("dad1", "dad2"),
      genders({ dad1: "m", dad2: "m" }),
    );
    expect(slots.paternalParent).toBe("dad1");
    expect(slots.maternalParent).toBe("dad2");
  });

  it("fills both slots for two unknown-gender parents", () => {
    const slots = reconstructParents(
      rels("a", "b"),
      genders({ a: "o", b: "o" }),
    );
    expect(slots).toEqual({ paternalParent: "a", maternalParent: "b" });
  });

  it("handles a single parent", () => {
    expect(reconstructParents(rels("mom"), genders({ mom: "f" }))).toEqual({
      paternalParent: null,
      maternalParent: "mom",
    });
  });

  it("returns empty slots when there are no parent relations", () => {
    expect(reconstructParents([], genders({}))).toEqual({
      paternalParent: null,
      maternalParent: null,
    });
  });

  it("ignores a third parent that cannot be represented", () => {
    const slots = reconstructParents(
      rels("a", "b", "c"),
      genders({ a: "m", b: "f", c: "m" }),
    );
    expect(slots).toEqual({ paternalParent: "a", maternalParent: "b" });
  });
});
