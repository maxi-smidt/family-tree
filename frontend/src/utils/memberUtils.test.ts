import { describe, expect, it } from "vitest";
import {
  reconstructParents,
  getMemberSearchText,
  formatMemberSubLabel,
  getMemberOptions,
} from "./memberUtils";
import { Member } from "@/types/member";

const makeMember = (overrides: Partial<Member> = {}): Member =>
  ({
    id: "m1",
    firstName: "Jane",
    lastName: "Doe",
    maidenName: null,
    date: { birth: "" },
    ...overrides,
  }) as Member;

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

describe("getMemberSearchText", () => {
  it("joins first, last, and maiden name", () => {
    const m = makeMember({
      firstName: "Jane",
      lastName: "Smith",
      maidenName: "Jones",
    });
    expect(getMemberSearchText(m)).toBe("Jane Smith Jones");
  });

  it("omits a null maiden name", () => {
    const m = makeMember({
      firstName: "Jane",
      lastName: "Smith",
      maidenName: null,
    });
    expect(getMemberSearchText(m)).toBe("Jane Smith");
  });
});

describe("formatMemberSubLabel", () => {
  const formatMaiden = (name: string) => `née ${name}`;

  it("returns maiden name and birth year when both are present", () => {
    expect(formatMemberSubLabel("Jones", "1900-05-01", formatMaiden)).toBe(
      "née Jones · 1900",
    );
  });

  it("returns just the maiden part when there is no birth year", () => {
    expect(formatMemberSubLabel("Jones", null, formatMaiden)).toBe("née Jones");
  });

  it("returns just the year when there is no maiden name", () => {
    expect(formatMemberSubLabel(null, "1900-05-01", formatMaiden)).toBe("1900");
  });

  it("returns undefined when neither is known", () => {
    expect(formatMemberSubLabel(null, null, formatMaiden)).toBeUndefined();
  });
});

describe("getMemberOptions", () => {
  it("maps members to options with label, value, sublabel, and searchValue", () => {
    const m = makeMember({
      id: "m42",
      firstName: "Jane",
      lastName: "Smith",
      maidenName: "Jones",
      date: { birth: "1900-05-01" },
    });
    const [option] = getMemberOptions([m], (name) => `née ${name}`);
    expect(option).toEqual({
      label: "Jane Smith",
      value: "m42",
      sublabel: "née Jones · 1900",
      searchValue: "Jane Smith Jones",
    });
  });
});
