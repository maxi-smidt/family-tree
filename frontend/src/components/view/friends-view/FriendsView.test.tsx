import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useFriendStore } from "@/hooks/useFriendStore";
import type { Friend } from "@/types/friend";
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
  beforeEach(async () => {
    await i18n.changeLanguage("en");
    useFriendStore.setState({
      friends: [friend],
      incoming: [],
      outgoing: [],
      loading: false,
      loadAll: vi.fn().mockResolvedValue(undefined),
    });
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
