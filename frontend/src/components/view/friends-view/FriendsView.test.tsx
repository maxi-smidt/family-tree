import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFriendStore } from "@/hooks/useFriendStore";
import type { Friend, UserSearchResult } from "@/types/friend";
import { FriendsView } from "./FriendsView";

vi.mock("@/components/auth/AccountAvatar", () => ({
  AccountAvatar: ({
    user,
  }: {
    user: {
      first_name?: string | null;
      last_name?: string | null;
      profile_image_url?: string | null;
    };
  }) => (
    <div
      data-testid="friend-avatar"
      data-first-name={user.first_name}
      data-last-name={user.last_name}
      data-profile-image-url={user.profile_image_url}
    />
  ),
}));

const friend: Friend = {
  user_id: "ada",
  username: "ada",
  full_name: "Ada Lovelace",
  first_name: "Ada",
  last_name: "Lovelace",
  profile_image_url: "/api/friends/ada/profile-image/avatar.webp",
  status: "accepted",
  direction: "outgoing",
  created_at: "2026-01-01T00:00:00Z",
  responded_at: "2026-01-01T00:00:00Z",
};

describe("FriendsView", () => {
  beforeEach(() => {
    useFriendStore.setState({
      friends: [friend],
      incoming: [],
      outgoing: [],
      loading: false,
      loadAll: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("filters the friends list by name or username without running a user search", () => {
    useFriendStore.setState({
      friends: [
        friend,
        {
          ...friend,
          user_id: "grace",
          username: "ghopper",
          full_name: "Grace Hopper",
        },
      ],
    });
    render(<FriendsView />);
    const filter = screen.getByRole("searchbox", {
      name: "Search your friends…",
    });
    fireEvent.change(filter, { target: { value: "HOPPER" } });
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "ada" } });
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.queryByText("Grace Hopper")).not.toBeInTheDocument();
    fireEvent.change(filter, { target: { value: "nobody" } });
    expect(
      screen.getByText("No friends match your search."),
    ).toBeInTheDocument();
    expect(useFriendStore.getState().search).not.toHaveBeenCalled();
  });

  it("keeps removal in the person menu and asks for confirmation", async () => {
    render(<FriendsView />);
    expect(
      screen.queryByRole("button", { name: "Remove friend" }),
    ).not.toBeInTheDocument();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Actions for Ada Lovelace" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Remove friend" }),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(useFriendStore.getState().remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(useFriendStore.getState().remove).toHaveBeenCalledWith(
      friend.user_id,
    );
  });

  it("discards an in-flight search response after clearing the query", async () => {
    vi.useFakeTimers();
    let resolveSearch!: (results: UserSearchResult[]) => void;
    const pending = new Promise<UserSearchResult[]>((resolve) => {
      resolveSearch = resolve;
    });
    useFriendStore.setState({ search: vi.fn().mockReturnValue(pending) });
    render(<FriendsView />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search by username…" }),
      { target: { value: "grace" } },
    );
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await act(async () => {
      resolveSearch([
        {
          user_id: "grace",
          username: "ghopper",
          full_name: "Grace Hopper",
          status: null,
          direction: null,
        },
      ]);
    });
    expect(screen.queryByText("Grace Hopper")).not.toBeInTheDocument();
    expect(screen.queryByText("Searching…")).not.toBeInTheDocument();
    expect(screen.queryByText("No users found.")).not.toBeInTheDocument();
  });

  it("passes the accepted friend's protected image and profile names to the shared avatar", () => {
    render(<FriendsView />);

    const avatar = screen.getByTestId("friend-avatar");
    expect(avatar).toHaveAttribute(
      "data-profile-image-url",
      friend.profile_image_url,
    );
    expect(avatar).toHaveAttribute("data-first-name", "Ada");
    expect(avatar).toHaveAttribute("data-last-name", "Lovelace");
  });
});
