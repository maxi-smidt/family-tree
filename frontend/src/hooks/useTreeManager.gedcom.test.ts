/**
 * Regression test: importing a GEDCOM file with a non-ISO qualifier date
 * ("BEF 1828") and a married-couple + child topology must leave three
 * members visible in the store after the import flow completes.
 *
 * Mirrors the exact API responses the backend returns for the GEDCOM 5.5.5
 * UTF-16 BE sample (555SAMPLE16BE.GED):
 *   GET /trees/{id}/members   → 3 members (Robert, Mary, Joe)
 *   GET /trees/{id}/relations → 3 relations (married + 2×parent)
 *   GET /trees/{id}/diseases  → []
 *   GET /trees/{id}/relation-types → seeded defaults
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTreeStore } from "./useTreeStore";
import { useMemberStore } from "./useMemberStore";
import { useEventStore } from "./useEventStore";
import { useStoryStore } from "./useStoryStore";
import { useGalleryStore } from "./useGalleryStore";
import { useActivityStore } from "./useActivityStore";
import { useAuthStore } from "./useAuthStore";
import { api } from "@/services/api";
import { TreeService } from "@/services/TreeService";
import { Tree } from "@/types/tree";
import { MemberDB, RelationDB } from "@/types/member";
import { ALL_FEATURES } from "@/lib/features";

vi.mock("@/services/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    postForm: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  },
  getAuthToken: vi.fn(() => null),
  setAuthToken: vi.fn(),
  onUnauthorized: vi.fn(),
}));
vi.mock("@/services/TreeService");

const IMPORTED_TREE: Tree = {
  id: "tree-gedcom",
  name: "555SAMPLE16BE",
  role: "owner",
};

// Exact shape the backend returns for the GEDCOM sample
const MEMBERS_DB: MemberDB[] = [
  {
    id: "robert",
    gender: "m",
    firstName: "Robert",
    lastName: "Williams",
    maidenName: null,
    imageData: null,
    dateOfBirth: "1822",
    dateOfDeath: null,
    additionalData: null,
    isCollapsed: 0,
    positionX: 0,
    positionY: 0,
  },
  {
    id: "mary",
    gender: "f",
    firstName: "Mary",
    lastName: "Wilson",
    maidenName: null,
    imageData: null,
    dateOfBirth: "BEF 1828", // ← GEDCOM qualifier — not ISO
    dateOfDeath: null,
    additionalData: null,
    isCollapsed: 0,
    positionX: 0,
    positionY: 0,
  },
  {
    id: "joe",
    gender: "m",
    firstName: "Joe",
    lastName: "Williams",
    maidenName: null,
    imageData: null,
    dateOfBirth: "11 Jun 1845",
    dateOfDeath: null,
    additionalData: null,
    isCollapsed: 0,
    positionX: 0,
    positionY: 0,
  },
];

const RELATIONS_DB: RelationDB[] = [
  { from_member_id: "robert", to_member_id: "mary", relation_type: "married" },
  { from_member_id: "joe", to_member_id: "robert", relation_type: "parent" },
  { from_member_id: "joe", to_member_id: "mary", relation_type: "parent" },
];

function mockSubStoresForGedcomTree() {
  vi.mocked(TreeService.getMembers).mockResolvedValue(MEMBERS_DB);
  vi.mocked(TreeService.getRelations).mockResolvedValue(RELATIONS_DB);
  vi.mocked(TreeService.getDiseases).mockResolvedValue([]);
  vi.mocked(TreeService.getGalleryImages).mockResolvedValue([]);
  vi.mocked(TreeService.getGalleryMemberLinks).mockResolvedValue([]);
  vi.mocked(TreeService.getEvents).mockResolvedValue([]);
  vi.mocked(TreeService.getEventMemberLinks).mockResolvedValue([]);
  vi.mocked(TreeService.getStories).mockResolvedValue([]);
  vi.mocked(TreeService.getStoryMemberLinks).mockResolvedValue([]);
  vi.mocked(TreeService.getActivity).mockResolvedValue([]);
  vi.mocked(TreeService.getRelationTypes).mockResolvedValue([
    { id: "parent" },
    { id: "married" },
    { id: "partner" },
    { id: "divorced" },
    { id: "sibling" },
  ]);
  // persistPositions calls updateMemberPositions
  vi.mocked(TreeService.updateMemberPositions).mockResolvedValue(undefined);
  vi.mocked(TreeService.listVirtualViews).mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  useTreeStore.setState({
    trees: [],
    virtualViews: [],
    selectedTree: undefined,
    metadata: {},
    relationTypes: [],
    isReady: false,
  });
  useMemberStore.setState({ members: [], undoStack: [], redoStack: [] });
  useEventStore.setState({ events: [] });
  useStoryStore.setState({ stories: [] });
  useGalleryStore.setState({ galleryImages: [] });
  useActivityStore.setState({ activities: [] });
  // All feature flags enabled (the production default) so connect() loads
  // every content store.
  useAuthStore.setState({ features: [...ALL_FEATURES] });
});

describe("importGedcom flow — GEDCOM 5.5.5 sample with BEF date", () => {
  it("stores all 3 imported members after selectTree + updateLayout", async () => {
    mockSubStoresForGedcomTree();

    // api.get handles: GET /trees/{id} (connect), GET /trees (loadTrees), metadata
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/trees/${IMPORTED_TREE.id}`)
        return Promise.resolve(IMPORTED_TREE);
      if (path === "/trees") return Promise.resolve([IMPORTED_TREE]);
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });
    // api.postForm returns the imported tree
    vi.mocked(api.postForm).mockResolvedValue(IMPORTED_TREE);

    // Simulate the importGedcom flow in useTreeManager:
    //   const tree = await api.postForm<Tree>("/trees/import-gedcom", form);
    //   await loadTrees();
    //   await selectTree(tree);
    //   await useMemberStore.getState().updateLayout();
    await vi.mocked(api.postForm)("/trees/import-gedcom", new FormData());
    const tree = IMPORTED_TREE;
    await useTreeStore.getState().loadTrees();
    await useTreeStore.getState().selectTree(tree);
    await useMemberStore.getState().updateLayout();

    const members = useMemberStore.getState().members;
    expect(members).toHaveLength(3);
    expect(members.map((m) => m.id).sort()).toEqual(["joe", "mary", "robert"]);
  });

  it("members remain in store even when updateLayout's persistPositions throws", async () => {
    mockSubStoresForGedcomTree();
    // Make updateMemberPositions reject to simulate a network error during layout persist
    vi.mocked(TreeService.updateMemberPositions).mockRejectedValue(
      new Error("Network error"),
    );
    // refreshMembers (called from updateLayout catch) also needs the members mock
    vi.mocked(TreeService.getMembers).mockResolvedValue(MEMBERS_DB);

    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/trees/${IMPORTED_TREE.id}`)
        return Promise.resolve(IMPORTED_TREE);
      if (path === "/trees") return Promise.resolve([IMPORTED_TREE]);
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    await useTreeStore.getState().loadTrees();
    await useTreeStore.getState().selectTree(IMPORTED_TREE);
    // updateLayout should swallow the error and call refreshMembers
    await useMemberStore.getState().updateLayout();

    const members = useMemberStore.getState().members;
    expect(members).toHaveLength(3);
  });

  it("all 3 members have finite positions after updateLayout", async () => {
    mockSubStoresForGedcomTree();

    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/trees/${IMPORTED_TREE.id}`)
        return Promise.resolve(IMPORTED_TREE);
      if (path === "/trees") return Promise.resolve([IMPORTED_TREE]);
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    await useTreeStore.getState().loadTrees();
    await useTreeStore.getState().selectTree(IMPORTED_TREE);
    await useMemberStore.getState().updateLayout();

    const members = useMemberStore.getState().members;
    expect(members).toHaveLength(3);
    for (const m of members) {
      expect(Number.isFinite(m.position.x), `${m.id}.x is not finite`).toBe(
        true,
      );
      expect(Number.isFinite(m.position.y), `${m.id}.y is not finite`).toBe(
        true,
      );
    }
  });

  it("Mary's BEF 1828 birth date is preserved verbatim through the store mapping", async () => {
    mockSubStoresForGedcomTree();

    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === `/trees/${IMPORTED_TREE.id}`)
        return Promise.resolve(IMPORTED_TREE);
      if (path === "/trees") return Promise.resolve([IMPORTED_TREE]);
      if (path.includes("/metadata")) return Promise.resolve({});
      return Promise.resolve([]);
    });

    await useTreeStore.getState().loadTrees();
    await useTreeStore.getState().selectTree(IMPORTED_TREE);

    const mary = useMemberStore.getState().members.find((m) => m.id === "mary");
    expect(mary).toBeDefined();
    expect(mary!.date.birth).toBe("BEF 1828");
  });
});
