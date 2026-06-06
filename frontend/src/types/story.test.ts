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
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        attachments: [],
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
        title: "Files only",
        content: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      const result = mapStoryFromDB(storyDB, ["member-1"]);
      expect(result.content).toBe("");
    });

    it("should map attachments and snake_case fields", () => {
      const storyDB: StoryDB = {
        id: "4",
        title: "With files",
        content: "See attached",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        attachments: [
          {
            id: "att-1",
            filename: "birth-certificate.pdf",
            url: "/api/media/tree-1/abc.pdf",
            mime_type: "application/pdf",
            size: 12345,
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      };

      const result = mapStoryFromDB(storyDB, ["member-1"]);
      expect(result.attachments).toEqual([
        {
          id: "att-1",
          filename: "birth-certificate.pdf",
          url: "/api/media/tree-1/abc.pdf",
          mimeType: "application/pdf",
          size: 12345,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ]);
    });
  });

  describe("mapStoryToDB", () => {
    it("should correctly map Story to StoryDB", () => {
      const story: Story = {
        id: "1",
        linkedMemberIds: ["member-1", "member-2"],
        title: "War Years",
        content: "Served in the military...",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-03T00:00:00Z",
        attachments: [],
      };

      const expected: StoryDB = {
        id: "1",
        title: "War Years",
        content: "Served in the military...",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-03T00:00:00Z",
        attachments: [],
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
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        attachments: [],
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
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-05T00:00:00Z",
        attachments: [
          {
            id: "att-1",
            filename: "photo.png",
            url: "/api/media/tree-1/x.png",
            mimeType: "image/png",
            size: 999,
            createdAt: "2024-01-01T00:00:00Z",
          },
        ],
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
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        attachments: [],
      };

      const db = mapStoryToDB(original);
      const result = mapStoryFromDB(db, linkedMemberIds);

      expect(result).toEqual(original);
      expect(result.content).toContain("\n");
      expect(result.content).toContain("\t");
    });
  });
});
