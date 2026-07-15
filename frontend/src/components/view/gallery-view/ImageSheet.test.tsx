import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useMemberStore } from "@/hooks/useMemberStore";
import { createMember, type Member } from "@/types/member";
import type { GalleryImage } from "@/types/gallery";
import { ImageSheet } from "./ImageSheet";

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const member = (id: string, firstName: string, lastName: string): Member => ({
  ...createMember({ x: 0, y: 0 }),
  id,
  firstName,
  lastName,
});

const ada = member("ada", "Ada", "Lovelace");
const alan = member("alan", "Alan", "Turing");

const image: GalleryImage = {
  id: "img-1",
  imageData: "/api/media/img-1.jpg",
  title: "Group photo",
  description: null,
  // Ada is already linked to this image.
  linkedMemberIds: ["ada"],
  createdAt: "2024-01-01T00:00:00Z",
  uploadedAt: "2024-01-01T00:00:00Z",
};

describe("ImageSheet linked-member selection", () => {
  beforeEach(async () => {
    // @ts-expect-error -- test-only polyfill
    global.ResizeObserver = MockResizeObserver;
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.releasePointerCapture = vi.fn();
    await i18n.changeLanguage("en");
    useMemberStore.setState({ members: [ada, alan] });
  });

  it("hides the already-linked member from the candidate list but keeps their chip", async () => {
    render(<ImageSheet isOpen onClose={vi.fn()} image={image} />);

    // The already-linked member stays visible as a removable chip.
    expect(
      screen.getByRole("button", { name: /Remove Ada Lovelace/ }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("combobox", { name: /Link members to this image/ }),
    );

    // ...but Alan, who is not linked, remains selectable.
    expect(
      await screen.findByRole("option", { name: /Alan Turing/ }),
    ).toBeInTheDocument();
    // Ada is already linked, so she is not offered again in the candidate list.
    expect(
      screen.queryByRole("option", { name: /Ada Lovelace/ }),
    ).not.toBeInTheDocument();
  });
});
