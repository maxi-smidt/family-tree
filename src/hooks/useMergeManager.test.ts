import { describe, it, expect } from "vitest";
import { MemberObject, MemberDB } from "@/types/member";

describe("useMergeManager", () => {
  describe("MemberObject.equalDB", () => {
    it("should return true for identical members", () => {
      const member1: MemberDB = {
        id: "1",
        gender: "m",
        firstName: "John",
        lastName: "Doe",
        maidenName: null,
        imageData: null,
        dateOfBirth: "1990-01-01",
        dateOfDeath: null,
        additionalData: null,
        isCollapsed: 0,
        positionX: 0,
        positionY: 0,
      };

      const member2: MemberDB = {
        ...member1,
        id: "2", // Different ID
        positionX: 100, // Different position
        positionY: 100,
      };

      expect(MemberObject.equalDB(member1, member2)).toBe(true);
    });

    it("should return false for different first names", () => {
      const member1: MemberDB = {
        id: "1",
        gender: "m",
        firstName: "John",
        lastName: "Doe",
        maidenName: null,
        imageData: null,
        dateOfBirth: "1990-01-01",
        dateOfDeath: null,
        additionalData: null,
        isCollapsed: 0,
        positionX: 0,
        positionY: 0,
      };

      const member2: MemberDB = {
        ...member1,
        firstName: "Jane",
      };

      expect(MemberObject.equalDB(member1, member2)).toBe(false);
    });

    it("should return false for different last names", () => {
      const member1: MemberDB = {
        id: "1",
        gender: "m",
        firstName: "John",
        lastName: "Doe",
        maidenName: null,
        imageData: null,
        dateOfBirth: "1990-01-01",
        dateOfDeath: null,
        additionalData: null,
        isCollapsed: 0,
        positionX: 0,
        positionY: 0,
      };

      const member2: MemberDB = {
        ...member1,
        lastName: "Smith",
      };

      expect(MemberObject.equalDB(member1, member2)).toBe(false);
    });

    it("should return false for different birth dates", () => {
      const member1: MemberDB = {
        id: "1",
        gender: "m",
        firstName: "John",
        lastName: "Doe",
        maidenName: null,
        imageData: null,
        dateOfBirth: "1990-01-01",
        dateOfDeath: null,
        additionalData: null,
        isCollapsed: 0,
        positionX: 0,
        positionY: 0,
      };

      const member2: MemberDB = {
        ...member1,
        dateOfBirth: "1991-01-01",
      };

      expect(MemberObject.equalDB(member1, member2)).toBe(false);
    });

    it("should be case-insensitive for names", () => {
      const member1: MemberDB = {
        id: "1",
        gender: "m",
        firstName: "John",
        lastName: "Doe",
        maidenName: null,
        imageData: null,
        dateOfBirth: "1990-01-01",
        dateOfDeath: null,
        additionalData: null,
        isCollapsed: 0,
        positionX: 0,
        positionY: 0,
      };

      const member2: MemberDB = {
        ...member1,
        firstName: "john", // lowercase
        lastName: "DOE", // uppercase
      };

      // Should match despite case differences
      expect(MemberObject.equalDB(member1, member2)).toBe(true);
    });

    it("should trim whitespace from names", () => {
      const member1: MemberDB = {
        id: "1",
        gender: "m",
        firstName: "John",
        lastName: "Doe",
        maidenName: null,
        imageData: null,
        dateOfBirth: "1990-01-01",
        dateOfDeath: null,
        additionalData: null,
        isCollapsed: 0,
        positionX: 0,
        positionY: 0,
      };

      const member2: MemberDB = {
        ...member1,
        firstName: "  John  ", // with whitespace
        lastName: " Doe ",
      };

      // Should match despite whitespace differences
      expect(MemberObject.equalDB(member1, member2)).toBe(true);
    });

    it("should handle death date differences", () => {
      const member1: MemberDB = {
        id: "1",
        gender: "m",
        firstName: "John",
        lastName: "Doe",
        maidenName: null,
        imageData: null,
        dateOfBirth: "1990-01-01",
        dateOfDeath: "2020-01-01",
        additionalData: null,
        isCollapsed: 0,
        positionX: 0,
        positionY: 0,
      };

      const member2: MemberDB = {
        ...member1,
        dateOfDeath: null, // One has death date, other doesn't
      };

      expect(MemberObject.equalDB(member1, member2)).toBe(false);
    });

    it("should ignore maiden name in equality check", () => {
      const member1: MemberDB = {
        id: "1",
        gender: "f",
        firstName: "Jane",
        lastName: "Doe",
        maidenName: "Smith",
        imageData: null,
        dateOfBirth: "1990-01-01",
        dateOfDeath: null,
        additionalData: null,
        isCollapsed: 0,
        positionX: 0,
        positionY: 0,
      };

      const member2: MemberDB = {
        ...member1,
        maidenName: null, // Different maiden name
      };

      // Current behavior: maiden name is NOT considered
      expect(MemberObject.equalDB(member1, member2)).toBe(true);
    });

    it("should ignore additional data in equality check", () => {
      const member1: MemberDB = {
        id: "1",
        gender: "m",
        firstName: "John",
        lastName: "Doe",
        maidenName: null,
        imageData: null,
        dateOfBirth: "1990-01-01",
        dateOfDeath: null,
        additionalData: "Some notes",
        isCollapsed: 0,
        positionX: 0,
        positionY: 0,
      };

      const member2: MemberDB = {
        ...member1,
        additionalData: "Different notes",
      };

      // Current behavior: additional data is NOT considered
      expect(MemberObject.equalDB(member1, member2)).toBe(true);
    });
  });
});
