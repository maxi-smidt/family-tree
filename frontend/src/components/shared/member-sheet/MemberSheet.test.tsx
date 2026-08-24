import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import type { Member } from "@/types/member";
import type { Workspace } from "@/types/workspace";
import type { MemberSheetTab } from "@/utils/memberSheetState";
import { MemberSheet } from "./MemberSheet";

// EditMode/ViewMode carry heavy subtrees (map inputs, markdown editor, child
// domain panels). Stub them down to the tab contract MemberSheet drives, so
// these tests exercise MemberSheet's own tab routing rather than those
// components' internals.
type TabStubProps = {
  activeTab: MemberSheetTab;
  onTabChange: (tab: MemberSheetTab) => void;
};

vi.mock("./EditMode", () => ({
  EditMode: ({ activeTab, onTabChange }: TabStubProps) => (
    <div>
      <span data-testid="edit-active-tab">{activeTab}</span>
      <button type="button" onClick={() => onTabChange("life")}>
        edit-go-life
      </button>
      <button type="button" onClick={() => onTabChange("identity")}>
        edit-go-identity
      </button>
    </div>
  ),
}));

vi.mock("./ViewMode", () => ({
  ViewMode: ({ activeTab, onTabChange }: TabStubProps) => (
    <div>
      <span data-testid="view-active-tab">{activeTab}</span>
      <button type="button" onClick={() => onTabChange("life")}>
        view-go-life
      </button>
    </div>
  ),
}));

// The sheet lazily refreshes secondary-domain stores and fetches full member
// detail when it opens for a saved member. Stub those hooks so mounting doesn't
// fire real network requests; `initialized: true` short-circuits every
// deferred load, and fetchMemberDetail resolves to a no-op.
vi.mock("@/hooks/useMemberStore", () => ({
  useMemberStore: () => ({
    removeMember: vi.fn(),
    fetchMemberDetail: vi.fn(() => Promise.resolve()),
    detailLoadedIds: new Set<string>(),
  }),
}));
vi.mock("@/hooks/useEventStore", () => ({
  useEventStore: () => ({ refreshEvents: vi.fn(), initialized: true }),
}));
vi.mock("@/hooks/useStoryStore", () => ({
  useStoryStore: () => ({ refreshStories: vi.fn(), initialized: true }),
}));
vi.mock("@/hooks/useTaskStore", () => ({
  useTaskStore: () => ({ refreshTasks: vi.fn(), initialized: true }),
}));
vi.mock("@/hooks/useDocumentStore", () => ({
  useDocumentStore: () => ({ refreshDocuments: vi.fn(), initialized: true }),
}));
vi.mock("@/hooks/useGalleryStore", () => ({
  useGalleryStore: () => ({ refreshGalleryImages: vi.fn(), initialized: true }),
}));

const TREE: Workspace = { id: "tree-1", name: "Workspace", role: "owner" };

const MEMBER: Member = {
  id: "member-1",
  gender: "f",
  academicTitle: null,
  firstName: "Ada",
  middleNames: null,
  baptismalName: null,
  lastName: "Lovelace",
  maidenName: null,
  imageData: null,
  deceased: false,
  adopted: false,
  date: { birth: "1815-12-10", death: null },
  parents: { paternalParent: null, maternalParent: null },
  additionalData: null,
  birthplace: null,
  hometown: null,
  cemetery: null,
  placesLived: [],
  isCollapsed: false,
  position: { x: 0, y: 0 },
};

const NEW_MEMBER: Member = { ...MEMBER, id: "temp-new-1", firstName: "" };

describe("MemberSheet tab switching", () => {
  beforeEach(() => {
    useMemberSheetStore.setState({ openSheets: {} });
    useWorkspaceStore.setState({ selectedTree: TREE });
  });

  it("switches Identity and Life for an unsaved new member", () => {
    render(
      <MemberSheet
        isOpen
        onClose={() => {}}
        member={NEW_MEMBER}
        initialEditMode
        isNewMember
      />,
    );

    expect(screen.getByTestId("edit-active-tab")).toHaveTextContent("identity");

    fireEvent.click(screen.getByText("edit-go-life"));
    expect(screen.getByTestId("edit-active-tab")).toHaveTextContent("life");

    fireEvent.click(screen.getByText("edit-go-identity"));
    expect(screen.getByTestId("edit-active-tab")).toHaveTextContent("identity");
  });

  it("keeps a new member's tab out of the persisted, member-id-keyed store", () => {
    render(
      <MemberSheet
        isOpen
        onClose={() => {}}
        member={NEW_MEMBER}
        initialEditMode
        isNewMember
      />,
    );

    fireEvent.click(screen.getByText("edit-go-life"));

    expect(useMemberSheetStore.getState().openSheets[TREE.id]).toBeUndefined();
  });

  it("persists a saved member's tab to the sheet store", async () => {
    render(
      <MemberSheet
        isOpen
        onClose={() => {}}
        member={MEMBER}
        initialEditMode
        canEdit
      />,
    );

    // Saved members show a brief spinner while detail loads; wait it out.
    fireEvent.click(await screen.findByText("edit-go-life"));

    expect(useMemberSheetStore.getState().openSheets[TREE.id]).toMatchObject({
      memberId: MEMBER.id,
      tab: "life",
    });
    expect(screen.getByTestId("edit-active-tab")).toHaveTextContent("life");
  });

  it("forces view mode and hides the edit toggle when canEdit is false", async () => {
    render(
      <MemberSheet
        isOpen
        onClose={() => {}}
        member={MEMBER}
        initialEditMode
        canEdit={false}
      />,
    );

    expect(await screen.findByTestId("view-active-tab")).toBeInTheDocument();
    expect(screen.queryByTestId("edit-active-tab")).not.toBeInTheDocument();
    // Only the mocked ViewMode's own "view-go-life" button should render;
    // the header's edit/view toggle button is omitted entirely when
    // effectiveCanEdit is false.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
