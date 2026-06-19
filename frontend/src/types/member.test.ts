import { describe, it, expect } from "vitest";
import { mapMemberFromDB, MemberDB, MemberObject, RelationDB } from "./member";

describe("mapMemberFromDB", () => {
  it("should correctly map a database member to a domain member", () => {
    const dbMember: MemberDB = {
      id: "1",
      gender: "m",
      academic_title: null,
      first_name: "John",
      last_name: "Doe",
      middle_names: "Paul",
      baptismal_name: "Johannes",
      maiden_name: null,
      image_data: null,
      date_of_birth: "1990-01-01",
      date_of_death: null,
      deceased: false,
      additional_data: null,
      is_collapsed: 0,
      position_x: 100,
      position_y: 200,
    };

    const relations: RelationDB[] = [];

    const result = mapMemberFromDB(dbMember, relations);

    expect(result.id).toBe("1");
    expect(result.firstName).toBe("John");
    expect(result.middleNames).toBe("Paul");
    expect(result.baptismalName).toBe("Johannes");
    expect(result.lastName).toBe("Doe");
    expect(result.gender).toBe("m");
    expect(result.date.birth).toBe("1990-01-01");
    expect(result.position.x).toBe(100);
    expect(result.position.y).toBe(200);
    expect(result.isCollapsed).toBe(false);
  });

  it("should handle collapsed state correctly", () => {
    const dbMember: MemberDB = {
      id: "1",
      gender: "f",
      academic_title: null,
      first_name: "Jane",
      last_name: "Doe",
      middle_names: null,
      baptismal_name: null,
      maiden_name: null,
      image_data: null,
      date_of_birth: "1992-01-01",
      date_of_death: null,
      deceased: false,
      additional_data: null,
      is_collapsed: 1,
      position_x: 0,
      position_y: 0,
    };

    const result = mapMemberFromDB(dbMember, []);
    expect(result.isCollapsed).toBe(true);
    expect(result.gender).toBe("f");
  });
});

describe("MemberObject.equalDB", () => {
  const member: MemberDB = {
    id: "1",
    gender: "m",
    academic_title: null,
    first_name: "John",
    middle_names: "Paul",
    baptismal_name: "Johannes",
    last_name: "Doe",
    maiden_name: null,
    image_data: null,
    date_of_birth: "1990",
    date_of_death: null,
    deceased: false,
    additional_data: null,
    is_collapsed: 0,
    position_x: 0,
    position_y: 0,
  };

  it("distinguishes middle and baptismal names", () => {
    expect(
      MemberObject.equalDB(member, { ...member, middle_names: "Peter" }),
    ).toBe(false);
    expect(
      MemberObject.equalDB(member, { ...member, baptismal_name: "Hans" }),
    ).toBe(false);
  });
});
