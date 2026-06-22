import { describe, it, expect } from "vitest";
import {
  createMember,
  mapMemberFromDB,
  mapMemberToDB,
  MemberDB,
  MemberObject,
  RelationDB,
} from "./member";

describe("mapMemberFromDB", () => {
  it("should correctly map a database member to a domain member", () => {
    const dbMember: MemberDB = {
      id: "1",
      gender: "m",
      academicTitle: null,
      firstName: "John",
      lastName: "Doe",
      middleNames: "Paul",
      baptismalName: "Johannes",
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
      academicTitle: null,
      firstName: "Jane",
      lastName: "Doe",
      middleNames: null,
      baptismalName: null,
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

describe("createMember", () => {
  it("does not default the birth date to the current year", () => {
    const m = createMember({ x: 0, y: 0 });
    expect(m.date.birth).toBe("");
    expect(m.date.death).toBeNull();
  });

  it("serializes to null dateOfBirth on the wire when birth is empty", () => {
    const m = createMember({ x: 0, y: 0 });
    const db = mapMemberToDB(m);
    expect(db.dateOfBirth).toBeNull();
  });
});

describe("MemberObject.equalDB", () => {
  const member: MemberDB = {
    id: "1",
    gender: "m",
    academicTitle: null,
    firstName: "John",
    middleNames: "Paul",
    baptismalName: "Johannes",
    lastName: "Doe",
    maidenName: null,
    imageData: null,
    dateOfBirth: "1990",
    dateOfDeath: null,
    deceased: false,
    additionalData: null,
    isCollapsed: 0,
    positionX: 0,
    positionY: 0,
  };

  it("distinguishes middle and baptismal names", () => {
    expect(
      MemberObject.equalDB(member, { ...member, middleNames: "Peter" }),
    ).toBe(false);
    expect(
      MemberObject.equalDB(member, { ...member, baptismalName: "Hans" }),
    ).toBe(false);
  });
});
