import { describe, it, expect } from "vitest";
import { Event, EventDB, mapEventFromDB, mapEventToDB } from "@/types/event";

describe("Event type mapping", () => {
  describe("mapEventFromDB", () => {
    it("should correctly map EventDB to Event with linked members", () => {
      const eventDB: EventDB = {
        id: "1",
        event_type: "Birth",
        date: "1990-01-01",
        location: "New York",
        description: "Born in New York",
        created_at: "2024-01-01T00:00:00Z",
      };

      const linkedMemberIds = ["member-1"];

      const expected: Event = {
        id: "1",
        linkedMemberIds: ["member-1"],
        eventType: "Birth",
        date: "1990-01-01",
        location: "New York",
        description: "Born in New York",
        createdAt: "2024-01-01T00:00:00Z",
        documentIds: [],
      };

      const result = mapEventFromDB(eventDB, linkedMemberIds);
      expect(result).toEqual(expected);
    });

    it("should handle multiple linked members", () => {
      const eventDB: EventDB = {
        id: "2",
        event_type: "Wedding",
        date: "2015-06-15",
        location: "Paris",
        description: "Wedding ceremony",
        created_at: "2024-01-01T00:00:00Z",
      };

      const linkedMemberIds = ["member-1", "member-2"];

      const result = mapEventFromDB(eventDB, linkedMemberIds);
      expect(result.linkedMemberIds).toEqual(["member-1", "member-2"]);
      expect(result.linkedMemberIds.length).toBe(2);
    });

    it("should handle null values correctly", () => {
      const eventDB: EventDB = {
        id: "2",
        event_type: "Graduation",
        date: "2010-06-15",
        location: null,
        description: null,
        created_at: "2024-01-01T00:00:00Z",
      };

      const result = mapEventFromDB(eventDB, ["member-1"]);
      expect(result.location).toBeNull();
      expect(result.description).toBeNull();
    });
  });

  describe("mapEventToDB", () => {
    it("should correctly map Event to EventDB", () => {
      const event: Event = {
        id: "1",
        linkedMemberIds: ["member-1", "member-2"],
        eventType: "Marriage",
        date: "2015-05-20",
        location: "London",
        description: "Wedding ceremony",
        createdAt: "2024-01-01T00:00:00Z",
        documentIds: ["doc-1"],
      };

      const expected: EventDB = {
        id: "1",
        event_type: "Marriage",
        date: "2015-05-20",
        location: "London",
        description: "Wedding ceremony",
        created_at: "2024-01-01T00:00:00Z",
        document_ids: ["doc-1"],
      };

      const result = mapEventToDB(event);
      expect(result).toEqual(expected);
    });

    it("should not include linkedMemberIds in DB representation", () => {
      const event: Event = {
        id: "3",
        linkedMemberIds: ["member-1"],
        eventType: "Death",
        date: "2020-12-31",
        location: null,
        description: null,
        createdAt: "2024-01-01T00:00:00Z",
        documentIds: [],
      };

      const result = mapEventToDB(event);
      expect(result).not.toHaveProperty("linkedMemberIds");
      expect(result.location).toBeNull();
      expect(result.description).toBeNull();
    });
  });

  describe("Bidirectional mapping", () => {
    it("should maintain data integrity when mapping back and forth", () => {
      const linkedMemberIds = ["member-1", "member-2"];
      const original: Event = {
        id: "test-id",
        linkedMemberIds,
        eventType: "Migration",
        date: "2000-01-01",
        location: "Paris",
        description: "Moved to Paris for work",
        createdAt: "2024-01-01T00:00:00Z",
        documentIds: ["doc-1", "doc-2"],
      };

      const db = mapEventToDB(original);
      const result = mapEventFromDB(db, linkedMemberIds);

      expect(result).toEqual(original);
    });
  });
});
