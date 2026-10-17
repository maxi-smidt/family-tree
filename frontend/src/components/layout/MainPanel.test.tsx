import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useFriendStore } from "@/hooks/useFriendStore";
import { useIdentityLinkStore } from "@/hooks/useIdentityLinkStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useTabPreferences } from "@/hooks/useTabPreferences";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import { type User } from "@/types/user";
import { MainPanel } from "./MainPanel";
import { AppNav } from "@/components/sidebar/AppNav";
import { SidebarProvider } from "@/components/ui/sidebar";
import { MobileTabBar } from "./MobileTabBar";

vi.mock("@/components/view/tree-view/FlowPanel", () => ({
  FlowPanel: () => <div>Tree view</div>,
}));
vi.mock("@/components/view/list-view/ListView", () => ({
  ListView: () => <div>List view</div>,
}));
vi.mock("@/components/view/gallery-view/GalleryView", () => ({
  GalleryView: () => <div>Gallery view</div>,
}));
vi.mock("@/components/view/media-view/MediaView", () => ({
  MediaView: ({ section }: { section: string }) => (
    <div>Media {section} view</div>
  ),
}));
vi.mock("@/components/view/timeline-view/TimelineView", () => ({
  TimelineView: () => <div>Timeline view</div>,
}));
vi.mock("@/components/view/activity-view/ActivityView", () => ({
  ActivityView: () => <div>Activity view</div>,
}));
vi.mock(
  "@/components/view/database-management-view/DatabaseManagementView",
  () => ({
    DatabaseManagementView: () => <div>Management view</div>,
  }),
);
vi.mock("@/components/view/quality-report-view/QualityReportView", () => ({
  QualityReportView: () => <div>Quality view</div>,
}));
vi.mock("@/components/view/statistics-view/StatisticsView", () => ({
  StatisticsView: () => <div>Statistics view</div>,
}));
vi.mock("@/components/view/map-view/MapView", () => ({
  MapView: () => <div>Map view</div>,
}));
vi.mock("@/components/view/friends-view/FriendsView", () => ({
  FriendsView: () => <div>Friends view</div>,
}));
vi.mock("@/components/layout/MobileManagementSheet", () => ({
  MobileManagementSheet: () => null,
}));

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

describe("MainPanel", () => {
  beforeEach(() => {
    localStorage.clear();

    useWorkspaceStore.setState({
      workspaces: [],
      selectedTree: undefined,
      metadata: {},
      relationTypes: [],
      isReady: false,
    });
    useTabPreferences.setState({
      order: [],
      hidden: [],
      loaded: true,
      load: vi.fn().mockResolvedValue(undefined),
    });
    useNavigationStore.setState({ pendingView: null });
    useUnsavedChangesStore.setState({
      guards: {},
      pendingNav: null,
      dialogOpen: false,
    });
    useAuthStore.setState({
      user: null,
    });
    useFriendStore.setState({
      friends: [],
      incoming: [],
      outgoing: [],
      loading: false,
      loadIncoming: vi.fn().mockResolvedValue(undefined),
    });
    useIdentityLinkStore.setState({
      incomingClaims: [],
      outgoingClaims: [],
      loadClaimInbox: vi.fn().mockResolvedValue(undefined),
    });
    useTutorialStore.setState({
      completed: false,
      loaded: false,
      isRunning: false,
    });
  });

  // jsdom doesn't implement matchMedia; the sidebar's useIsMobile needs it.
  const stubMatchMedia = () => {
    window.matchMedia ??= vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  };

  const renderWithNav = () => {
    stubMatchMedia();
    return render(
      <SidebarProvider>
        <AppNav />
        <MainPanel />
      </SidebarProvider>,
    );
  };

  it("keeps Tree, Workspaces, and Friends in the navigation for a fresh account", () => {
    renderWithNav();

    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(nav).getByRole("button", { name: "Tree" }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByRole("button", { name: "Workspaces" }),
    ).toBeInTheDocument();
    expect(
      within(nav).getByRole("button", { name: "Friends" }),
    ).toBeInTheDocument();

    expect(
      within(nav).queryByRole("button", { name: "People" }),
    ).not.toBeInTheDocument();
    expect(
      within(nav).queryByRole("button", { name: "Gallery" }),
    ).not.toBeInTheDocument();
  });

  it("gives phones a tab bar with the main views and everything else under More", async () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", role: "owner", restrictions: [] } as never,
    });
    stubMatchMedia();
    render(
      <SidebarProvider>
        <MainPanel />
        <MobileTabBar />
      </SidebarProvider>,
    );

    const bar = screen.getByRole("navigation", { name: "Quick navigation" });
    expect(
      within(bar)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Tree", "People", "Timeline", "Gallery", "More"]);

    fireEvent.click(within(bar).getByRole("button", { name: "Timeline" }));
    await waitFor(() => {
      expect(screen.getByText("Timeline view")).toBeInTheDocument();
    });
    expect(
      within(bar).getByRole("button", { name: "Timeline" }),
    ).toHaveAttribute("aria-current", "page");

    const more = within(bar).getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
  });

  it("opens Gallery and Documents straight from the navigation", async () => {
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", role: "owner", restrictions: [] } as never,
    });
    renderWithNav();

    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(
      within(nav).getByRole("button", { name: "Gallery" }),
    ).toBeInTheDocument();
    fireEvent.click(within(nav).getByRole("button", { name: "Documents" }));
    await waitFor(() => {
      expect(screen.getByText("Media documents view")).toBeInTheDocument();
    });
    expect(localStorage.getItem("ft_active_tab")).toBe("media-view");
    expect(localStorage.getItem("ft_active_media_section")).toBe("documents");
  });

  it("restores the selected Media section after a refresh", async () => {
    localStorage.setItem("ft_active_tab", "media-view");
    localStorage.setItem("ft_active_media_section", "documents");
    useWorkspaceStore.setState({
      selectedTree: { id: "tree-1", role: "owner", restrictions: [] } as never,
    });
    render(<MainPanel />);

    await waitFor(() => {
      expect(screen.getByText("Media documents view")).toBeInTheDocument();
    });
  });

  it("starts the tutorial after preferences load", async () => {
    useAuthStore.setState({
      user: USER,
    });
    useTutorialStore.setState({
      completed: false,
      loaded: true,
      isRunning: false,
    });

    render(<MainPanel />);

    await waitFor(() => {
      expect(useTutorialStore.getState().isRunning).toBe(true);
    });
  });

  it("does not start the tutorial while the legal gate is open", () => {
    useAuthStore.setState({
      user: {
        ...USER,
        legal_acceptance_required: true,
        legal_accepted: false,
      },
    });
    useTutorialStore.setState({
      completed: false,
      loaded: true,
      isRunning: false,
    });

    render(<MainPanel />);

    expect(useTutorialStore.getState().isRunning).toBe(false);
  });

  it("starts the tutorial once the legal gate is accepted", async () => {
    useAuthStore.setState({
      user: {
        ...USER,
        legal_acceptance_required: true,
        legal_accepted: false,
      },
    });
    useTutorialStore.setState({
      completed: false,
      loaded: true,
      isRunning: false,
    });

    render(<MainPanel />);

    expect(useTutorialStore.getState().isRunning).toBe(false);

    act(() => {
      useAuthStore.setState({
        user: {
          ...USER,
          legal_acceptance_required: true,
          legal_accepted: true,
        },
      });
    });

    await waitFor(() => {
      expect(useTutorialStore.getState().isRunning).toBe(true);
    });
  });
});
