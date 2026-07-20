import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import type { GalleryImage } from "@/types/gallery";
import type { Member } from "@/types/member";
import type { Tree } from "@/types/tree";
import { EditMode } from "./EditMode";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/hooks/useMediaUrl", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useMediaUrl")>(
    "@/hooks/useMediaUrl",
  );
  return {
    ...actual,
    fetchMediaObjectUrl: vi.fn().mockResolvedValue("blob:mock-object-url"),
  };
});

// Every feature on, so the Records children would render if the tab mounts.
vi.mock("@/hooks/useAuthStore", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useAuthStore")>(
    "@/hooks/useAuthStore",
  );
  return { ...actual, useFeature: () => true };
});

// Stub the Records children so the test exercises only the lazy-mount wiring,
// not each domain section's own data loading.
vi.mock("./MemberPhotos", () => ({
  MemberPhotos: () => <div data-testid="records-child">photos</div>,
}));
vi.mock("./MemberEvents", () => ({ MemberEvents: () => null }));
vi.mock("./MemberStories", () => ({ MemberStories: () => null }));
vi.mock("./MemberDocuments", () => ({ MemberDocuments: () => null }));
vi.mock("./MemberDiseases", () => ({ MemberDiseases: () => null }));
vi.mock("./MemberTasks", () => ({ MemberTasks: () => null }));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error -- test-only polyfill for Radix
global.ResizeObserver = MockResizeObserver;

const TREE: Tree = {
  id: "tree-1",
  name: "Tree",
  role: "owner",
  restrictions: [],
};
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

describe("EditMode records tab", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.setPointerCapture = vi.fn();
    useMemberStore.setState({ members: [MEMBER] });
    useTreeStore.setState({ selectedTree: TREE });
  });

  // Regression for #767: a sheet restored directly onto Records (e.g. after a
  // page refresh) must show its content without a tab round-trip.
  it("mounts the Records content when opened directly on that tab", () => {
    render(
      <EditMode member={MEMBER} activeTab="records" onTabChange={() => {}} />,
    );
    expect(screen.getByTestId("records-child")).toBeInTheDocument();
  });

  it("does not mount the Records content while another tab is active", () => {
    render(
      <EditMode member={MEMBER} activeTab="identity" onTabChange={() => {}} />,
    );
    expect(screen.queryByTestId("records-child")).not.toBeInTheDocument();
  });
});

describe("EditMode profile picture avatar", () => {
  const LINKED_IMAGE: GalleryImage = {
    id: "image-1",
    imageData: "data:image/png;base64,abc",
    title: "Portrait",
    description: null,
    linkedMemberIds: [MEMBER.id],
    memberLinks: [],
    unknownFaces: [],
    createdAt: "2024-01-01T00:00:00Z",
    uploadedAt: "2024-01-01T00:00:00Z",
  };

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.releasePointerCapture = vi.fn();
    Element.prototype.setPointerCapture = vi.fn();
    URL.revokeObjectURL = vi.fn();
    useMemberStore.setState({ members: [MEMBER] });
    useTreeStore.setState({ selectedTree: TREE });
    useGalleryStore.setState({ galleryImages: [], initialized: true });
  });

  it("opens the file picker directly when the member has no linked photos", () => {
    render(
      <EditMode member={MEMBER} activeTab="identity" onTabChange={() => {}} />,
    );

    const avatarTrigger = screen.getByRole("button", {
      name: "Change profile picture",
    });
    fireEvent.pointerDown(avatarTrigger, { pointerType: "mouse" });
    fireEvent.click(avatarTrigger);

    expect(screen.queryByText("Choose from gallery")).not.toBeInTheDocument();
  });

  it("offers upload vs. gallery choice when the member has linked photos", async () => {
    useGalleryStore.setState({
      galleryImages: [LINKED_IMAGE],
      initialized: true,
    });
    render(
      <EditMode member={MEMBER} activeTab="identity" onTabChange={() => {}} />,
    );

    const avatarTrigger = screen.getByRole("button", {
      name: "Change profile picture",
    });
    fireEvent.pointerDown(avatarTrigger, { pointerType: "mouse" });
    fireEvent.click(avatarTrigger);

    expect(await screen.findByText("Upload a photo")).toBeInTheDocument();
    expect(screen.getByText("Choose from gallery")).toBeInTheDocument();
  });

  it("opens the crop dialog after picking a linked gallery photo", async () => {
    useGalleryStore.setState({
      galleryImages: [LINKED_IMAGE],
      initialized: true,
    });
    render(
      <EditMode member={MEMBER} activeTab="identity" onTabChange={() => {}} />,
    );

    const avatarTrigger = screen.getByRole("button", {
      name: "Change profile picture",
    });
    fireEvent.pointerDown(avatarTrigger, { pointerType: "mouse" });
    fireEvent.click(avatarTrigger);
    fireEvent.click(await screen.findByText("Choose from gallery"));
    fireEvent.click(await screen.findByRole("button", { name: "Portrait" }));

    expect(await screen.findByText("Crop image")).toBeInTheDocument();
  });
});
