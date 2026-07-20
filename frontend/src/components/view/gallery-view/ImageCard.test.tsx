import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useMemberStore } from "@/hooks/useMemberStore";
import type { GalleryImage } from "@/types/gallery";
import type { Member } from "@/types/member";
import { ImageCard } from "./ImageCard";

function makeMember(overrides: Partial<Member> & { id: string }): Member {
  return {
    gender: "o",
    academicTitle: null,
    firstName: "First",
    middleNames: null,
    baptismalName: null,
    lastName: "Last",
    maidenName: null,
    imageData: null,
    deceased: false,
    adopted: false,
    date: { birth: "1990", death: null },
    parents: { paternalParent: null, maternalParent: null },
    additionalData: null,
    birthplace: null,
    hometown: null,
    cemetery: null,
    placesLived: [],
    isCollapsed: false,
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

const alice = makeMember({ id: "member-1", firstName: "Alice", lastName: "A" });
const bob = makeMember({ id: "member-2", firstName: "Bob", lastName: "B" });
const carol = makeMember({ id: "member-3", firstName: "Carol", lastName: "C" });

function makeImage(overrides: Partial<GalleryImage> = {}): GalleryImage {
  return {
    id: "image-1",
    imageData: "/api/media/image-1.jpg",
    title: "A photo",
    description: null,
    linkedMemberIds: [],
    memberLinks: [],
    unknownFaces: [],
    createdAt: "2024-01-01T00:00:00Z",
    uploadedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ImageCard linked members", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useMemberStore.setState({ members: [alice, bob, carol] });
  });

  it("keeps the linked-names row's space reserved but invisible when there are no links", () => {
    const { container } = render(
      <ImageCard image={makeImage()} onClick={vi.fn()} />,
    );

    expect(screen.queryByText(/Alice/)).not.toBeInTheDocument();
    const row = container.querySelector(".invisible");
    expect(row).toBeInTheDocument();
  });

  it("shows resolved names for linked members", () => {
    render(
      <ImageCard
        image={makeImage({ linkedMemberIds: ["member-1", "member-2"] })}
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Alice A, Bob B")).toBeInTheDocument();
  });

  it("shows a +N more suffix once the visible name limit is exceeded", () => {
    render(
      <ImageCard
        image={makeImage({
          linkedMemberIds: ["member-1", "member-2", "member-3"],
        })}
        onClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Alice A, Bob B +1 more")).toBeInTheDocument();
  });

  it("skips ids that no longer resolve to a member", () => {
    render(
      <ImageCard
        image={makeImage({ linkedMemberIds: ["missing-member"] })}
        onClick={vi.fn()}
      />,
    );

    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });
});
