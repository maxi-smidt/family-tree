import { describe, it, expect } from "vitest";
import { Story, StoryDB, mapStoryFromDB, mapStoryToDB } from "@/types/story";

describe("Story type mapping", () => {
  describe("mapStoryFromDB", () => {
    it("should correctly map StoryDB to Story with linked members", () => {
      const storyDB: StoryDB = {
        id: "1",
        title: "Early Life",
        content: "Born in a small town...",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      };

      const linkedMemberIds = ["member-1"];

      const expected: Story = {
        id: "1",
        linkedMemberIds: ["member-1"],
        title: "Early Life",
        content: "Born in a small town...",
        date: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        documentIds: [],
      };

      const result = mapStoryFromDB(storyDB, linkedMemberIds);
      expect(result).toEqual(expected);
    });

    it("should handle multiple linked members", () => {
      const storyDB: StoryDB = {
        id: "2",
        title: "Family Story",
        content: "This is a story about multiple family members...",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      const linkedMemberIds = ["member-1", "member-2", "member-3"];

      const result = mapStoryFromDB(storyDB, linkedMemberIds);
      expect(result.linkedMemberIds).toEqual([
        "member-1",
        "member-2",
        "member-3",
      ]);
      expect(result.linkedMemberIds.length).toBe(3);
    });

    it("should handle long content correctly", () => {
      const longContent = "This is a very long story. ".repeat(100);
      const storyDB: StoryDB = {
        id: "2",
        title: "Life Story",
        content: longContent,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      const result = mapStoryFromDB(storyDB, ["member-1"]);
      expect(result.content).toEqual(longContent);
      expect(result.content.length).toBeGreaterThan(1000);
    });

    it("should map null content to an empty string", () => {
      const storyDB: StoryDB = {
        id: "3",
        title: "Notes only",
        content: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      const result = mapStoryFromDB(storyDB, ["member-1"]);
      expect(result.content).toBe("");
    });

    it("should map linked document ids", () => {
      const storyDB: StoryDB = {
        id: "4",
        title: "With documents",
        content: "See linked documents",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        document_ids: ["doc-1", "doc-2"],
      };

      const result = mapStoryFromDB(storyDB, ["member-1"]);
      expect(result.documentIds).toEqual(["doc-1", "doc-2"]);
    });
  });

  describe("mapStoryToDB", () => {
    it("should correctly map Story to StoryDB", () => {
      const story: Story = {
        id: "1",
        linkedMemberIds: ["member-1", "member-2"],
        title: "War Years",
        content: "Served in the military...",
        date: "1942",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-03T00:00:00Z",
        documentIds: [],
      };

      const expected: StoryDB = {
        id: "1",
        title: "War Years",
        content: "Served in the military...",
        date: "1942",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-03T00:00:00Z",
        document_ids: [],
      };

      const result = mapStoryToDB(story);
      expect(result).toEqual(expected);
    });

    it("should not include linkedMemberIds in DB representation", () => {
      const story: Story = {
        id: "2",
        linkedMemberIds: ["member-1"],
        title: "Test Story",
        content: "Test content",
        date: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        documentIds: [],
      };

      const result = mapStoryToDB(story);
      expect(result).not.toHaveProperty("linkedMemberIds");
    });
  });

  describe("Bidirectional mapping", () => {
    it("should maintain data integrity when mapping back and forth", () => {
      const linkedMemberIds = ["member-1", "member-2"];
      const original: Story = {
        id: "test-id",
        linkedMemberIds,
        title: "A Wonderful Life",
        content: "This is the story of a wonderful life...",
        date: "1950-05",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-05T00:00:00Z",
        documentIds: ["doc-1"],
      };

      const db = mapStoryToDB(original);
      const result = mapStoryFromDB(db, linkedMemberIds);

      expect(result).toEqual(original);
    });

    it("should preserve special characters in content", () => {
      const linkedMemberIds = ["member-1"];
      const original: Story = {
        id: "test-id",
        linkedMemberIds,
        title: "Special Characters Test",
        content: "Content with special chars: \n\t'\"<>&",
        date: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        documentIds: [],
      };

      const db = mapStoryToDB(original);
      const result = mapStoryFromDB(db, linkedMemberIds);

      expect(result).toEqual(original);
      expect(result.content).toContain("\n");
      expect(result.content).toContain("\t");
    });
  });
});
