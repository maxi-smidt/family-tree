import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n/i18n";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useFriendStore } from "@/hooks/useFriendStore";
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useTabPreferences } from "@/hooks/useTabPreferences";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useUnsavedChangesStore } from "@/hooks/useUnsavedChangesStore";
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
});
