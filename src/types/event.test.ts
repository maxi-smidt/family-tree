import { describe, it, expect } from "vitest";
import { Event, EventDB, mapEventFromDB, mapEventToDB } from "@/types/event";

describe("Event type mapping", () => {
  describe("mapEventFromDB", () => {
    it("should correctly map EventDB to Event", () => {
      const eventDB: EventDB = {
        id: "1",
        member_id: "member-1",
        event_type: "Birth",
        date: "1990-01-01",
        location: "New York",
        description: "Born in New York",
        created_at: "2024-01-01T00:00:00Z",
      };

      const expected: Event = {
        id: "1",
        memberId: "member-1",
        eventType: "Birth",
        date: "1990-01-01",
        location: "New York",
        description: "Born in New York",
        createdAt: "2024-01-01T00:00:00Z",
      };

      const result = mapEventFromDB(eventDB);
      expect(result).toEqual(expected);
    });

    it("should handle null values correctly", () => {
      const eventDB: EventDB = {
        id: "2",
        member_id: "member-2",
        event_type: "Graduation",
        date: "2010-06-15",
        location: null,
        description: null,
        created_at: "2024-01-01T00:00:00Z",
      };

      const result = mapEventFromDB(eventDB);
      expect(result.location).toBeNull();
      expect(result.description).toBeNull();
    });
  });

  describe("mapEventToDB", () => {
    it("should correctly map Event to EventDB", () => {
      const event: Event = {
        id: "1",
        memberId: "member-1",
        eventType: "Marriage",
        date: "2015-05-20",
        location: "London",
        description: "Wedding ceremony",
        createdAt: "2024-01-01T00:00:00Z",
      };

      const expected: EventDB = {
        id: "1",
        member_id: "member-1",
        event_type: "Marriage",
        date: "2015-05-20",
        location: "London",
        description: "Wedding ceremony",
        created_at: "2024-01-01T00:00:00Z",
      };

      const result = mapEventToDB(event);
      expect(result).toEqual(expected);
    });

    it("should handle null values correctly", () => {
      const event: Event = {
        id: "3",
        memberId: "member-3",
        eventType: "Death",
        date: "2020-12-31",
        location: null,
        description: null,
        createdAt: "2024-01-01T00:00:00Z",
      };

      const result = mapEventToDB(event);
      expect(result.location).toBeNull();
      expect(result.description).toBeNull();
    });
  });

  describe("Bidirectional mapping", () => {
    it("should maintain data integrity when mapping back and forth", () => {
      const original: Event = {
        id: "test-id",
        memberId: "test-member",
        eventType: "Migration",
        date: "2000-01-01",
        location: "Paris",
        description: "Moved to Paris for work",
        createdAt: "2024-01-01T00:00:00Z",
      };

      const db = mapEventToDB(original);
      const result = mapEventFromDB(db);

      expect(result).toEqual(original);
    });
  });
});
