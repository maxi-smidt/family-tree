import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useFriendStore } from "@/hooks/useFriendStore";
import { usePresenceStore } from "@/hooks/usePresenceStore";
import type { Friend } from "@/types/friend";
import type { PresenceUser } from "@/types/presence";
import type { User } from "@/types/user";
import { PresenceChips } from "./PresenceChips";

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
      data-testid="presence-avatar"
      data-profile-image-url={user.profile_image_url}
    />
  ),
}));

const CURRENT_USER: User = {
  id: "me",
  username: "me",
  email: null,
  full_name: "Me User",
  first_name: "Me",
  last_name: "User",
  profile_image_url: "/api/auth/profile/image/me.webp",
  is_admin: false,
  is_active: true,
  auth_provider: "local",
  created_at: "2026-01-01T00:00:00Z",
};

const ROSTER: PresenceUser[] = [
  {
    userId: "me",
    displayName: "Me User",
    firstName: "Me",
    lastName: "User",
    editingMemberId: null,
  },
  {
    userId: "friend",
    displayName: "Friend User",
    firstName: "Friend",
    lastName: "User",
    editingMemberId: null,
  },
  {
    userId: "collaborator",
    displayName: "Collaborator User",
    firstName: "Collaborator",
    lastName: "User",
    editingMemberId: null,
  },
];

const FRIEND: Friend = {
  user_id: "friend",
  username: "friend",
  full_name: "Friend User",
  first_name: "Friend",
  last_name: "User",
  profile_image_url: "/api/friends/friend/profile-image/friend.webp",
  status: "accepted",
  direction: "outgoing",
  created_at: "2026-01-01T00:00:00Z",
  responded_at: "2026-01-01T00:00:00Z",
};

describe("PresenceChips", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: CURRENT_USER });
    usePresenceStore.setState({ roster: ROSTER, recentlyActiveUserIds: [] });
    useFriendStore.setState({
      friends: [FRIEND],
      loadFriends: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("uses profile images only for the current user and accepted friends", () => {
    render(<PresenceChips />);

    const avatars = screen.getAllByTestId("presence-avatar");
    expect(avatars[0]).toHaveAttribute(
      "data-profile-image-url",
      CURRENT_USER.profile_image_url,
    );
    expect(avatars[1]).toHaveAttribute(
      "data-profile-image-url",
      FRIEND.profile_image_url,
    );
    expect(avatars[2]).not.toHaveAttribute("data-profile-image-url");
  });

  it("hides a solo user and renders every avatar once collaborators join", () => {
    usePresenceStore.setState({ roster: [ROSTER[0]] });
    const { rerender } = render(<PresenceChips />);

    expect(screen.queryByTestId("presence-avatar")).not.toBeInTheDocument();

    act(() => {
      usePresenceStore.setState({
        roster: [
          ...ROSTER,
          {
            userId: "fourth",
            displayName: "Fourth User",
            firstName: "Fourth",
            lastName: "User",
            editingMemberId: null,
          },
          {
            userId: "fifth",
            displayName: "Fifth User",
            firstName: "Fifth",
            lastName: "User",
            editingMemberId: null,
          },
          {
            userId: "sixth",
            displayName: "Sixth User",
            firstName: "Sixth",
            lastName: "User",
            editingMemberId: null,
          },
        ],
      });
    });
    rerender(<PresenceChips />);

    expect(screen.getAllByTestId("presence-avatar")).toHaveLength(6);
  });
});
