import { describe, it, expect } from "vitest";
import {
  Document,
  DocumentDB,
  DocumentFileDB,
  mapDocumentFileFromDB,
  mapDocumentFromDB,
} from "@/types/document";

describe("Document type mapping", () => {
  describe("mapDocumentFileFromDB", () => {
    it("maps snake_case file fields to camelCase", () => {
      const row: DocumentFileDB = {
        id: "f1",
        kind: "file",
        filename: "birth-certificate.pdf",
        url: "/api/media/tree-1/abc.pdf",
        mime_type: "application/pdf",
        size: 12345,
        created_at: "2024-01-01T00:00:00Z",
      };

      expect(mapDocumentFileFromDB(row)).toEqual({
        id: "f1",
        kind: "file",
        filename: "birth-certificate.pdf",
        url: "/api/media/tree-1/abc.pdf",
        mimeType: "application/pdf",
        size: 12345,
        createdAt: "2024-01-01T00:00:00Z",
      });
    });

    it("maps an external link file", () => {
      const row: DocumentFileDB = {
        id: "l1",
        kind: "link",
        filename: "Archive entry",
        url: "https://example.com/record/42",
        mime_type: null,
        size: null,
        created_at: "2024-01-01T00:00:00Z",
      };

      const result = mapDocumentFileFromDB(row);
      expect(result.kind).toBe("link");
      expect(result.url).toBe("https://example.com/record/42");
      expect(result.mimeType).toBeNull();
      expect(result.size).toBeNull();
    });
  });

  describe("mapDocumentFromDB", () => {
    it("maps a full document with files and link ids", () => {
      const row: DocumentDB = {
        id: "d1",
        title: "Birth Certificate",
        description: "Scanned original",
        document_date: "1950-04-02",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-02T00:00:00Z",
        files: [
          {
            id: "f1",
            kind: "file",
            filename: "cert.pdf",
            url: "/api/media/tree-1/cert.pdf",
            mime_type: "application/pdf",
            size: 999,
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
        member_ids: ["m1", "m2"],
        event_ids: ["e1"],
        story_ids: ["s1"],
      };

      const expected: Document = {
        id: "d1",
        title: "Birth Certificate",
        description: "Scanned original",
        documentDate: "1950-04-02",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        files: [
          {
            id: "f1",
            kind: "file",
            filename: "cert.pdf",
            url: "/api/media/tree-1/cert.pdf",
            mimeType: "application/pdf",
            size: 999,
            createdAt: "2024-01-01T00:00:00Z",
          },
        ],
        memberIds: ["m1", "m2"],
        eventIds: ["e1"],
        storyIds: ["s1"],
      };

      expect(mapDocumentFromDB(row)).toEqual(expected);
    });

    it("defaults optional collections to empty arrays", () => {
      const row: DocumentDB = {
        id: "d2",
        title: "Note",
        description: null,
        document_date: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      const result = mapDocumentFromDB(row);
      expect(result.files).toEqual([]);
      expect(result.memberIds).toEqual([]);
      expect(result.eventIds).toEqual([]);
      expect(result.storyIds).toEqual([]);
      expect(result.description).toBeNull();
      expect(result.documentDate).toBeNull();
    });
  });
});
