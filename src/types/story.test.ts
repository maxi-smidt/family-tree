import { describe, it, expect } from "vitest";
import { Story, StoryDB, mapStoryFromDB, mapStoryToDB } from "@/types/story";

describe("Story type mapping", () => {
  describe("mapStoryFromDB", () => {
    it("should correctly map StoryDB to Story", () => {
      const storyDB: StoryDB = {
        id: "1",
        member_id: "member-1",
        title: "Early Life",
        content: "Born in a small town...",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
      };

      const expected: Story = {
        id: "1",
        memberId: "member-1",
        title: "Early Life",
        content: "Born in a small town...",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
      };

      const result = mapStoryFromDB(storyDB);
      expect(result).toEqual(expected);
    });

    it("should handle long content correctly", () => {
      const longContent = "This is a very long story. ".repeat(100);
      const storyDB: StoryDB = {
        id: "2",
        member_id: "member-2",
        title: "Life Story",
        content: longContent,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      const result = mapStoryFromDB(storyDB);
      expect(result.content).toEqual(longContent);
      expect(result.content.length).toBeGreaterThan(1000);
    });
  });

  describe("mapStoryToDB", () => {
    it("should correctly map Story to StoryDB", () => {
      const story: Story = {
        id: "1",
        memberId: "member-1",
        title: "War Years",
        content: "Served in the military...",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-03T00:00:00Z",
      };

      const expected: StoryDB = {
        id: "1",
        member_id: "member-1",
        title: "War Years",
        content: "Served in the military...",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-03T00:00:00Z",
      };

      const result = mapStoryToDB(story);
      expect(result).toEqual(expected);
    });
  });

  describe("Bidirectional mapping", () => {
    it("should maintain data integrity when mapping back and forth", () => {
      const original: Story = {
        id: "test-id",
        memberId: "test-member",
        title: "A Wonderful Life",
        content: "This is the story of a wonderful life...",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-05T00:00:00Z",
      };

      const db = mapStoryToDB(original);
      const result = mapStoryFromDB(db);

      expect(result).toEqual(original);
    });

    it("should preserve special characters in content", () => {
      const original: Story = {
        id: "test-id",
        memberId: "test-member",
        title: "Special Characters Test",
        content: "Content with special chars: \n\t'\"<>&",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };

      const db = mapStoryToDB(original);
      const result = mapStoryFromDB(db);

      expect(result).toEqual(original);
      expect(result.content).toContain("\n");
      expect(result.content).toContain("\t");
    });
  });
});
