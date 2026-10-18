import { lazy, useEffect, useLayoutEffect } from "react";
import { Tabs } from "@/components/ui/tabs";
import { TabWrapper } from "@/components/layout/TabWrapper";

const FlowPanel = lazy(() =>
  import("@/components/view/tree-view/FlowPanel").then((m) => ({
    default: m.FlowPanel,
  })),
);
const ListView = lazy(() =>
  import("@/components/view/list-view/ListView").then((m) => ({
    default: m.ListView,
  })),
);
const MediaView = lazy(() =>
  import("@/components/view/media-view/MediaView").then((m) => ({
    default: m.MediaView,
  })),
);
const TimelineView = lazy(() =>
  import("@/components/view/timeline-view/TimelineView").then((m) => ({
    default: m.TimelineView,
  })),
);
const ActivityView = lazy(() =>
  import("@/components/view/activity-view/ActivityView").then((m) => ({
    default: m.ActivityView,
  })),
);
const DatabaseManagementView = lazy(() =>
  import("@/components/view/database-management-view/DatabaseManagementView").then(
    (m) => ({ default: m.DatabaseManagementView }),
  ),
);
const QualityReportView = lazy(() =>
  import("@/components/view/quality-report-view/QualityReportView").then(
    (m) => ({ default: m.QualityReportView }),
  ),
);
const StatisticsView = lazy(() =>
  import("@/components/view/statistics-view/StatisticsView").then((m) => ({
    default: m.StatisticsView,
  })),
);
const MapView = lazy(() =>
  import("@/components/view/map-view/MapView").then((m) => ({
    default: m.MapView,
  })),
);
const FriendsView = lazy(() =>
  import("@/components/view/friends-view/FriendsView").then((m) => ({
    default: m.FriendsView,
  })),
);
const IdentityLinksView = lazy(() =>
  import("@/components/view/identity-links-view/IdentityLinksView").then(
    (m) => ({ default: m.IdentityLinksView }),
  ),
);
import { useNavigationStore } from "@/hooks/useNavigationStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useFriendStore } from "@/hooks/useFriendStore";
import { useIdentityLinkStore } from "@/hooks/useIdentityLinkStore";
import { useTabPreferences } from "@/hooks/useTabPreferences";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { useLegalStore } from "@/hooks/useLegalStore";
import { LEGAL_DEFAULT_LOCALE } from "@/lib/legalLocale";
import { TREE_VIEW, ViewId } from "@/lib/tabs";
import { useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { useMemberSheetStore } from "@/hooks/useMemberSheetStore";
import { usePresence } from "@/hooks/usePresence";
import { useActiveViewStore } from "@/hooks/useActiveViewStore";
import { requestLocationReplace, useUrlLocation } from "@/hooks/useUrlLocation";
import { useVisibleViews } from "@/hooks/useVisibleViews";
import { WorkspaceBreadcrumb } from "@/components/layout/WorkspaceBreadcrumb";

const VIEW_COMPONENTS: Omit<Record<ViewId, React.ReactNode>, "media-view"> = {
  "tree-view": <FlowPanel />,
  "list-view": <ListView />,
  "timeline-view": <TimelineView />,
  "map-view": <MapView />,
  "activity-view": <ActivityView />,
  "quality-report-view": <QualityReportView />,
  "statistics-view": <StatisticsView />,
  "database-management-view": <DatabaseManagementView />,
  "friends-view": <FriendsView />,
  "identity-links-view": <IdentityLinksView />,
};

export const MainPanel = () => {
  // Announce this client's presence and track who else is in the tree.
  usePresence();
  // Mirror where the user is into the URL, and follow it on back/forward.
  useUrlLocation();

  const activeTab = useActiveViewStore((s) => s.activeView);
  const activeMediaSection = useActiveViewStore((s) => s.mediaSection);
  const applyTab = useActiveViewStore((s) => s.setActiveView);

  // Re-read the persisted view on mount (a fresh session or a test may have
  // written localStorage after the store module first initialised).
  useLayoutEffect(() => {
    useActiveViewStore.getState().hydrate();
  }, []);

  const { pendingView, clearPending } = useNavigationStore();
  useEffect(() => {
    if (pendingView !== null) {
      applyTab(pendingView);
      clearPending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingView]);

  const selectedTreeId = useWorkspaceStore((s) => s.selectedTree?.id);
  const hasOpenMemberSheet = useMemberSheetStore((s) =>
    selectedTreeId ? Boolean(s.openSheets[selectedTreeId]) : false,
  );
  useEffect(() => {
    if (hasOpenMemberSheet && activeTab !== TREE_VIEW) applyTab(TREE_VIEW);
  }, [activeTab, hasOpenMemberSheet]); // eslint-disable-line react-hooks/exhaustive-deps

  const user = useAuthStore((s) => s.user);
  const load = useTabPreferences((s) => s.load);
  const loadTutorial = useTutorialStore((s) => s.load);
  const tutorialLoaded = useTutorialStore((s) => s.loaded);
  const tutorialCompleted = useTutorialStore((s) => s.completed);
  const tutorialRunning = useTutorialStore((s) => s.isRunning);
  const startTutorial = useTutorialStore((s) => s.start);
  const legalGateOpen =
    !!user?.legal_acceptance_required && !user?.legal_accepted;
  const loadLegalDocuments = useLegalStore((s) => s.load);
  const loadIncomingFriends = useFriendStore((s) => s.loadIncoming);
  const loadIdentityClaimInbox = useIdentityLinkStore((s) => s.loadClaimInbox);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    if (user) void loadTutorial();
  }, [user, loadTutorial]);

  // The legal gate takes priority over onboarding — it's a compliance
  // requirement, not a UX nicety — so it loads as soon as a user is
  // present, regardless of tutorial state.
  useEffect(() => {
    if (user && user.legal_acceptance_required && !user.legal_accepted) {
      void loadLegalDocuments(LEGAL_DEFAULT_LOCALE);
    }
  }, [user, loadLegalDocuments]);

  // Hold the tutorial until the blocking legal gate is accepted; otherwise the
  // tour highlights elements hidden behind the legal dialog (#615). Accepting
  // terms flips user.legal_accepted (via refreshMe), which re-runs this effect.
  useEffect(() => {
    if (
      tutorialLoaded &&
      !tutorialCompleted &&
      !tutorialRunning &&
      !legalGateOpen
    ) {
      startTutorial();
    }
  }, [
    tutorialLoaded,
    tutorialCompleted,
    tutorialRunning,
    legalGateOpen,
    startTutorial,
  ]);

  // Keep the navigation badges (Friends, Identity links)
  // accurate without opening those views.
  useEffect(() => {
    if (user) void loadIncomingFriends();
  }, [user, loadIncomingFriends]);

  useEffect(() => {
    if (user) void loadIdentityClaimInbox();
  }, [user, loadIdentityClaimInbox]);

  const { visible, loaded } = useVisibleViews();

  // If the active view is hidden and no pending navigation, move to first visible.
  useEffect(() => {
    if (loaded && pendingView === null && !visible.includes(activeTab)) {
      // A correction, not a step the user took — don't leave the hidden
      // page behind in history.
      requestLocationReplace();
      applyTab(visible[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, visible, activeTab, pendingView]);

  const viewComponents: Record<ViewId, React.ReactNode> = {
    ...VIEW_COMPONENTS,
    "media-view": <MediaView section={activeMediaSection} />,
  };

  // Tabs is kept purely as the content switcher (TabsContent mounts only the
  // active view); navigation itself lives in the left sidebar (AppNav).
  return (
    <Tabs value={activeTab} className="h-full flex flex-col gap-0">
      <WorkspaceBreadcrumb />
      {Object.entries(viewComponents).map(([view, component]) => (
        <TabWrapper key={view} value={view}>
          {component}
        </TabWrapper>
      ))}
    </Tabs>
  );
};
