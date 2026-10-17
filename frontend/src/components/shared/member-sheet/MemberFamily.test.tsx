import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMember, type Member, type Relation } from "@/types/member";
import { useMemberStore } from "@/hooks/useMemberStore";
import { MemberFamily } from "./MemberFamily";

function person(
  id: string,
  firstName: string,
  gender: Member["gender"],
  overrides: Partial<Member> = {},
): Member {
  return {
    ...createMember({ x: 0, y: 0 }),
    id,
    firstName,
    lastName: "Gruber",
    gender,
    ...overrides,
  };
}

const karl = person("karl", "Karl", "m");
const helga = person("helga", "Helga", "f");
const thomas = person("thomas", "Thomas", "m", {
  parents: { paternalParent: "karl", maternalParent: "helga" },
  relations: [
    {
      id: "r1",
      fromMemberId: "thomas",
      toMemberId: "sabine",
      relationType: "married",
    } as Relation,
  ],
});
const sabine = person("sabine", "Sabine", "f");
const lena = person("lena", "Lena", "f", {
  parents: { paternalParent: "thomas", maternalParent: "sabine" },
});
const claudia = person("claudia", "Claudia", "f", {
  parents: { paternalParent: "karl", maternalParent: "helga" },
});

describe("MemberFamily rows", () => {
  const initial = useMemberStore.getState().members;
  afterEach(() => useMemberStore.setState({ members: initial }));

  it("names each relative by how they are related", () => {
    useMemberStore.setState({
      members: [karl, helga, thomas, sabine, lena, claudia],
    });
    const onOpen = vi.fn();
    render(
      <MemberFamily member={thomas} layout="rows" onOpenMember={onOpen} />,
    );

    const list = screen.getByRole("list");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Father"),
      expect.stringContaining("Mother"),
      expect.stringContaining("Wife"),
      expect.stringContaining("Daughter"),
      expect.stringContaining("Sister"),
    ]);

    fireEvent.click(within(list).getByRole("button", { name: /Lena Gruber/ }));
    expect(onOpen).toHaveBeenCalledWith("lena");
  });
});
