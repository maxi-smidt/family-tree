import "./App.css";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/hooks/useAuthStore";
import { resetLegalStoreForSession } from "@/hooks/useLegalStore";
import { resetTreeStoreForSession, useWorkspaceStore } from "@/hooks/useWorkspaceStore";
import { resetTutorialStoreForSession } from "@/hooks/useTutorialStore";
import { resetNotificationStoreForSession } from "@/hooks/useNotificationStore";
import { migrateV1BrowserState } from "@/utils/migrateBrowserState";
import { startRealtime, stopRealtime } from "@/services/realtime";
import { useAdminViewStore } from "@/hooks/useAdminViewStore";
import { useUserSettingsViewStore } from "@/hooks/useUserSettingsViewStore";
import { Layout } from "@/components/layout/Layout";
import { MainPanel } from "@/components/layout/MainPanel";
import { AdminView } from "@/components/admin/AdminView";
import { UserSettingsView } from "@/components/settings/UserSettingsView";
import { ErrorBoundary } from "@/components/layout/ErrorBoundary";
import { UnsavedChangesGuard } from "@/components/layout/UnsavedChangesGuard";
import { LoginPage } from "@/components/auth/LoginPage";
import { AuthUnreachableScreen } from "@/components/auth/AuthUnreachableScreen";
import { AppUpgradeRequiredScreen } from "@/components/auth/AppUpgradeRequiredScreen";
import { MaintenanceScreen } from "@/components/auth/MaintenanceScreen";
import { PublicTreeViewer } from "@/components/public/PublicTreeViewer";
import { ReloginDialog } from "@/components/auth/ReloginDialog";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export const App = () => {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;
  const pendingPublicTreeId = useAuthStore((s) => s.pendingPublicTreeId);
  const loadTrees = useWorkspaceStore((s) => s.loadTrees);
  const openTreeById = useWorkspaceStore((s) => s.openTreeById);
  const [treesBootstrapped, setTreesBootstrapped] = useState(false);
  const [publicTreeFallback, setPublicTreeFallback] = useState(false);
  const adminOpen = useAdminViewStore((s) => s.open);
  const settingsOpen = useUserSettingsViewStore((s) => s.open);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (status !== "authenticated" || !userId) {
      setTreesBootstrapped(false);
      setPublicTreeFallback(false);
      resetLegalStoreForSession();
      resetTreeStoreForSession();
      resetTutorialStoreForSession();
      resetNotificationStoreForSession();
      stopRealtime();
      return;
    }

    let cancelled = false;
    setTreesBootstrapped(false);
    setPublicTreeFallback(false);
    resetLegalStoreForSession();
    resetTreeStoreForSession();
    resetTutorialStoreForSession();
    resetNotificationStoreForSession();
    // Best-effort and independent of the bootstrap sequence below — must
    // never block login or tree loading (see migrateV1BrowserState's docs).
    void migrateV1BrowserState();

    void (async () => {
      try {
        // Accept a pending invite (from an #invite= link) before loading workspaces
        // so the newly granted tree appears in the list immediately.
        const { acceptPendingInvite } = useAuthStore.getState();
        await acceptPendingInvite();

        await loadTrees();
        startRealtime();

        // Public links are also useful to signed-in visitors. Resolve the
        // linked tree directly because public workspaces outside the user's own
        // membership list are intentionally absent from GET /workspaces. A
        // password-protected or otherwise inaccessible target falls back to
        // the public viewer so it can request the public password.
        const { pendingPublicTreeId: targetWorkspaceId } = useAuthStore.getState();
        if (targetWorkspaceId) {
          try {
            await openTreeById(targetWorkspaceId);
            useAuthStore.setState({ pendingPublicTreeId: null });
            return;
          } catch {
            if (!cancelled) setPublicTreeFallback(true);
            return;
          }
        }

        // Re-open the most recently used tree (or virtual view). The API
        // returns both lists sorted by `last_opened`, newest first.
        const { selectedTree, workspaces, virtualViews, selectTree } =
          useWorkspaceStore.getState();
        const nextTree = workspaces[0] ?? virtualViews[0];
        if (!selectedTree && nextTree) {
          await selectTree(nextTree);
        }
      } finally {
        if (!cancelled) {
          setTreesBootstrapped(true);
        }
      }
    })();

    return () => {
      cancelled = true;
      stopRealtime();
    };
  }, [status, userId, loadTrees, openTreeById]);

  // The Toaster lives at the root so toasts are visible in every auth state —
  // including the login screen, which renders outside the authenticated Layout.
  return (
    <>
      {renderContent()}
      <ReloginDialog />
      <Toaster position="bottom-center" />
    </>
  );

  function renderContent() {
    if (status === "loading") {
      return (
        <div className="w-screen h-screen flex items-center justify-center">
          <Spinner className="size-8" />
        </div>
      );
    }

    if (status === "unreachable") {
      return <AuthUnreachableScreen />;
    }

    if (status === "upgrade-required") {
      return <AppUpgradeRequiredScreen />;
    }

    if (status === "starting") {
      return <MaintenanceScreen />;
    }

    if (status === "unauthenticated") {
      if (pendingPublicTreeId) {
        return <PublicTreeViewer workspaceId={pendingPublicTreeId} />;
      }
      return <LoginPage />;
    }

    if (!treesBootstrapped) {
      return (
        <div className="w-screen h-screen flex items-center justify-center">
          <Spinner className="size-8" />
        </div>
      );
    }

    if (pendingPublicTreeId && publicTreeFallback) {
      return <PublicTreeViewer workspaceId={pendingPublicTreeId} />;
    }

    return (
      <ErrorBoundary>
        <UnsavedChangesGuard />
        {adminOpen && user?.is_admin ? (
          <TooltipProvider delayDuration={500}>
            <AdminView />
          </TooltipProvider>
        ) : settingsOpen ? (
          <UserSettingsView />
        ) : (
          <Layout>
            <MainPanel />
          </Layout>
        )}
      </ErrorBoundary>
    );
  }
};
