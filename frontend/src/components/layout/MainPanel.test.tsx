import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useFriendStore } from "@/hooks/useFriendStore";
import { useWhatsNewStore } from "@/hooks/useWhatsNewStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useTabPreferences } from "@/hooks/useTabPreferences";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
import { type User } from "@/types/user";
import { MainPanel } from "./MainPanel";

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
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage("en");

    useTreeStore.setState({
      trees: [],
      virtualViews: [],
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
      features: [],
    });
    useFriendStore.setState({
      friends: [],
      incoming: [],
      outgoing: [],
      loading: false,
      loadIncoming: vi.fn().mockResolvedValue(undefined),
    });
    useTutorialStore.setState({
      completed: false,
      loaded: false,
      isRunning: false,
    });
    useWhatsNewStore.setState({
      lastReadVersion: null,
      loaded: false,
      dismissed: false,
      load: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("keeps Tree, Tree Management, and Friends visible for a fresh account", () => {
    render(<MainPanel />);

    expect(screen.getByRole("tab", { name: "Tree" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Tree Management" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Friends" })).toBeInTheDocument();

    expect(screen.queryByRole("tab", { name: "List" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Gallery" }),
    ).not.toBeInTheDocument();
  });

  it("opens Gallery and Documents from the Media tab menu", async () => {
    useTreeStore.setState({
      selectedTree: { id: "tree-1", role: "owner", restrictions: [] } as never,
    });
    useAuthStore.setState({ features: ["gallery", "sources"] });

    render(<MainPanel />);

    expect(screen.getByRole("tab", { name: "Media" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Gallery" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Documents" }),
    ).not.toBeInTheDocument();
    const mediaTab = screen.getByRole("tab", { name: "Media" });
    fireEvent.pointerDown(mediaTab, { button: 0, ctrlKey: false });
    fireEvent.click(mediaTab);
    expect(
      screen.getByRole("menuitem", { name: "Gallery" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Documents" }));
    await waitFor(() => {
      expect(screen.getByText("Media documents view")).toBeInTheDocument();
    });
  });

  it("starts the tutorial when the onboarding feature arrives after preferences load", async () => {
    useAuthStore.setState({
      user: USER,
      features: [],
    });
    useTutorialStore.setState({
      completed: false,
      loaded: true,
      isRunning: false,
    });

    render(<MainPanel />);

    expect(useTutorialStore.getState().isRunning).toBe(false);

    act(() => {
      useAuthStore.setState({ features: ["onboarding_tour"] });
    });

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
      features: ["onboarding_tour"],
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
      features: ["onboarding_tour"],
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

  it("does not load What's New before onboarding is complete", async () => {
    const loadIncomingFriends = vi.fn().mockResolvedValue(undefined);
    useAuthStore.setState({
      user: USER,
      features: [],
    });
    useFriendStore.setState({
      loadIncoming: loadIncomingFriends,
    });
    useTutorialStore.setState({
      completed: false,
      loaded: true,
      isRunning: false,
    });
    const loadWhatsNew = vi.fn().mockResolvedValue(undefined);
    useWhatsNewStore.setState({ load: loadWhatsNew });

    render(<MainPanel />);

    await waitFor(() => {
      expect(loadIncomingFriends).toHaveBeenCalled();
    });
    expect(loadWhatsNew).not.toHaveBeenCalled();
  });

  it("loads What's New after onboarding is complete", async () => {
    useAuthStore.setState({
      user: USER,
      features: [],
    });
    useTutorialStore.setState({
      completed: true,
      loaded: true,
      isRunning: false,
    });
    const loadWhatsNew = vi.fn().mockResolvedValue(undefined);
    useWhatsNewStore.setState({ load: loadWhatsNew });

    render(<MainPanel />);

    await waitFor(() => {
      expect(loadWhatsNew).toHaveBeenCalledTimes(1);
    });
  });
});
