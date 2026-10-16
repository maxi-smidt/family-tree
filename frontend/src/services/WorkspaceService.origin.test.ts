import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceService } from "./WorkspaceService";
import { api } from "./api";

vi.mock("./api", () => ({
  UPLOAD_STAGE_TIMEOUT_MS: 120000,
  api: { post: vi.fn(), put: vi.fn(), postForm: vi.fn() },
}));

beforeEach(() => vi.clearAllMocks());

describe("content creation HTTP scope", () => {
  it("carries the origin section in every content creation transport", () => {
    const section = "private / section";
    const suffix = "?origin_section_id=" + encodeURIComponent(section);
    WorkspaceService.addEvent(
      "w",
      "e",
      { eventType: "birth", date: "2000", location: null, description: null },
      "now",
      [],
      section,
    );
    WorkspaceService.addStory(
      "w",
      "s",
      { title: "Story", content: "Private" },
      "now",
      [],
      section,
    );
    WorkspaceService.addTask(
      "w",
      "t",
      "Private task",
      null,
      "now",
      [],
      section,
    );
    WorkspaceService.addDocument(
      "w",
      { title: "Private document", description: "", documentDate: "" },
      [],
      section,
    );
    WorkspaceService.addDisease(
      "w",
      "d",
      "m",
      {
        name: "Private diagnosis",
        carrierStatus: "unknown",
        inheritancePattern: "unknown",
        diagnosisDate: null,
        notes: null,
      },
      section,
    );
    WorkspaceService.uploadGalleryImage(
      "w",
      "g",
      new File(["bytes"], "photo.png"),
      { title: "Photo", description: null, memberIds: [] },
      "now",
      section,
    );
    WorkspaceService.saveDocument(
      "w",
      "doc",
      {
        title: "Private",
        description: null,
        document_date: null,
        member_ids: [],
        attached_upload_ids: [],
        added_links: [],
        removed_file_ids: [],
        renamed_files: [],
      },
      section,
    );
    for (const resource of [
      "events",
      "stories",
      "tasks",
      "documents",
      "diseases",
    ]) {
      expect(api.post).toHaveBeenCalledWith(
        `/workspaces/w/${resource}${suffix}`,
        expect.any(Object),
      );
    }
    expect(api.postForm).toHaveBeenCalledWith(
      `/workspaces/w/gallery/images${suffix}`,
      expect.any(FormData),
    );
    expect(api.put).toHaveBeenCalledWith(
      `/workspaces/w/documents/doc${suffix}`,
      expect.any(Object),
    );
  });
});
