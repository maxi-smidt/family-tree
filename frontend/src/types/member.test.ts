import { describe, it, expect } from "vitest";
import { mapMemberFromDB, MemberDB, RelationDB } from "./member";

describe("mapMemberFromDB", () => {
  it("should correctly map a database member to a domain member", () => {
    const dbMember: MemberDB = {
      id: "1",
      gender: "m",
      firstName: "John",
      lastName: "Doe",
      maidenName: null,
      imageData: null,
      dateOfBirth: "1990-01-01",
      dateOfDeath: null,
      deceased: false,
      additionalData: null,
      isCollapsed: 0,
      positionX: 100,
      positionY: 200,
    };

    const relations: RelationDB[] = [];

    const result = mapMemberFromDB(dbMember, relations);

    expect(result.id).toBe("1");
    expect(result.firstName).toBe("John");
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
      firstName: "Jane",
      lastName: "Doe",
      maidenName: null,
      imageData: null,
      dateOfBirth: "1992-01-01",
      dateOfDeath: null,
      deceased: false,
      additionalData: null,
      isCollapsed: 1,
      positionX: 0,
      positionY: 0,
    };

    const result = mapMemberFromDB(dbMember, []);
    expect(result.isCollapsed).toBe(true);
    expect(result.gender).toBe("f");
  });
});
