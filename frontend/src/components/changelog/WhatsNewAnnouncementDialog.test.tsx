import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { useUserSettingsViewStore } from "@/hooks/useUserSettingsViewStore";
import { useWhatsNewStore } from "@/hooks/useWhatsNewStore";
import { APP_VERSION } from "@/lib/buildInfo";
import { type User } from "@/types/user";
import { WhatsNewAnnouncementDialog } from "./WhatsNewAnnouncementDialog";

const USER: User = {
  id: "user-1",
  username: "first-user",
  email: null,
  full_name: null,
  is_admin: false,
  is_active: true,
  auth_provider: "local",
  created_at: "2026-01-01T00:00:00Z",
};

describe("WhatsNewAnnouncementDialog", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: USER });
    useTutorialStore.setState({ completed: true, loaded: true });
    useWhatsNewStore.setState({
      lastReadVersion: "previous-version",
      loaded: true,
      dismissed: false,
      markAsRead: vi.fn().mockResolvedValue(undefined),
    });
    useUserSettingsViewStore.setState({
      open: false,
      activeSection: "gallery",
      openSettings: vi.fn(),
    });
  });

  it("opens once when the stored version differs", () => {
    render(<WhatsNewAnnouncementDialog />);

    expect(
      screen.getByRole("heading", { name: `What's new in v${APP_VERSION}` }),
    ).toBeInTheDocument();
  });

  it("does not open when the current version was already read", () => {
    useWhatsNewStore.setState({ lastReadVersion: APP_VERSION });

    render(<WhatsNewAnnouncementDialog />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("marks the version as read and opens Settings on the changelog", () => {
    const markAsRead = vi.fn().mockResolvedValue(undefined);
    const openSettings = vi.fn();
    useWhatsNewStore.setState({ markAsRead });
    useUserSettingsViewStore.setState({ openSettings });

    render(<WhatsNewAnnouncementDialog />);
    fireEvent.click(screen.getByRole("button", { name: "View changelog" }));

    expect(markAsRead).toHaveBeenCalledTimes(1);
    expect(openSettings).toHaveBeenCalledWith("changelog");
  });
});
