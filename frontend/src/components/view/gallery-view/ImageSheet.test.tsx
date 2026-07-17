import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import type { GalleryImage } from "@/types/gallery";
import type { Member } from "@/types/member";
import { ImageSheet } from "./ImageSheet";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error -- test-only polyfill for Radix popovers
global.ResizeObserver = MockResizeObserver;

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

const UNLINKED_MEMBER: Member = {
  ...MEMBER,
  id: "member-2",
  firstName: "Alan",
  lastName: "Turing",
};

const IMAGE: GalleryImage = {
  id: "image-1",
  imageData: "data:image/png;base64,abc",
  title: "Portrait",
  description: null,
  linkedMemberIds: [MEMBER.id],
  memberLinks: [{ memberId: MEMBER.id, x: null, y: null, w: null, h: null }],
  createdAt: "2024-01-01T00:00:00Z",
  uploadedAt: "2024-01-01T00:00:00Z",
};

describe("ImageSheet", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.releasePointerCapture = vi.fn();
    await i18n.changeLanguage("en");
    useMemberStore.setState({ members: [MEMBER, UNLINKED_MEMBER] });
    useTreeStore.setState({
      selectedTree: { id: "tree-1", name: "Tree", role: "owner" },
    });
  });

  it("hides already-linked people from candidates while keeping their link visible", async () => {
    render(<ImageSheet isOpen onClose={vi.fn()} image={IMAGE} />);

    expect(
      screen.getByRole("button", { name: "Remove Ada Lovelace" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox"));

    expect(
      await screen.findByRole("option", { name: /Alan Turing/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Ada Lovelace/ }),
    ).not.toBeInTheDocument();
  });
});
