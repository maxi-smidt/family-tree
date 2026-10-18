import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMember } from "@/types/member";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useEventStore } from "@/hooks/useEventStore";
import { useStoryStore } from "@/hooks/useStoryStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { MemberDetailDialog } from "./MemberDetailDialog";

const parent = {
  ...createMember({ x: 0, y: 0 }),
  id: "parent",
  firstName: "Karl",
  lastName: "Gruber",
  deceased: true,
};
const child = {
  ...createMember({ x: 0, y: 0 }),
  id: "child",
  firstName: "Anna",
  lastName: "Gruber",
  parents: { paternalParent: parent.id, maternalParent: null },
};
const initialMembers = useMemberStore.getState();
const initialEvents = useEventStore.getState();
const initialStories = useStoryStore.getState();
const initialGallery = useGalleryStore.getState();
const fetchDetail = vi.fn(async (id: string) =>
  [parent, child].find((member) => member.id === id),
);

describe("MemberDetailDialog family navigation", () => {
  beforeEach(() => {
    fetchDetail.mockClear();
    useMemberStore.setState({
      members: [parent, child],
      detailLoadedIds: new Set([parent.id, child.id]),
      fetchMemberDetail: fetchDetail,
    });
    useEventStore.setState({ events: [], initialized: true });
    useStoryStore.setState({ stories: [], initialized: true });
    useGalleryStore.setState({ galleryImages: [], initialized: true });
  });
  afterEach(() => {
    useMemberStore.setState(initialMembers);
    useEventStore.setState(initialEvents);
    useStoryStore.setState(initialStories);
    useGalleryStore.setState(initialGallery);
  });

  it("loads a clicked relative inside the same dialog", async () => {
    render(<MemberDetailDialog member={parent} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Anna Gruber/ }));
    expect(
      screen.getByRole("dialog", { name: "Anna Gruber" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await waitFor(() => expect(fetchDetail).toHaveBeenCalledWith(child.id));
    fireEvent.click(screen.getByRole("button", { name: /Karl Gruber/ }));
    expect(
      screen.getByRole("dialog", { name: "Karl Gruber" }),
    ).toBeInTheDocument();
  });

  it("returns to the original person when reopened", async () => {
    const props = { member: parent, onOpenChange: () => {} };
    const { rerender } = render(<MemberDetailDialog {...props} open />);
    fireEvent.click(screen.getByRole("button", { name: /Anna Gruber/ }));
    await waitFor(() => expect(fetchDetail).toHaveBeenCalledWith(child.id));
    rerender(<MemberDetailDialog {...props} open={false} />);
    rerender(<MemberDetailDialog {...props} open />);
    expect(
      screen.getByRole("dialog", { name: "Karl Gruber" }),
    ).toBeInTheDocument();
  });

  it("does not describe a deceased person without a death date as alive", () => {
    render(<MemberDetailDialog member={parent} open onOpenChange={() => {}} />);
    expect(screen.queryByText("Alive")).not.toBeInTheDocument();
    expect(screen.getAllByText("Deceased").length).toBeGreaterThan(0);
  });
});
