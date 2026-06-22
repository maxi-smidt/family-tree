import "./App.css";
import { useEffect, useState } from "react";
import { useAuthStore } from "@/hooks/useAuthStore";
import { resetTreeStoreForSession, useTreeStore } from "@/hooks/useTreeStore";
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
  const loadTrees = useTreeStore((s) => s.loadTrees);
  const [treesBootstrapped, setTreesBootstrapped] = useState(false);
  const adminOpen = useAdminViewStore((s) => s.open);
  const settingsOpen = useUserSettingsViewStore((s) => s.open);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (status !== "authenticated" || !userId) {
      setTreesBootstrapped(false);
      resetTreeStoreForSession();
      stopRealtime();
      return;
    }

    let cancelled = false;
    setTreesBootstrapped(false);
    resetTreeStoreForSession();

    void (async () => {
      try {
        // Accept a pending invite (from an #invite= link) before loading trees
        // so the newly granted tree appears in the list immediately.
        const { acceptPendingInvite } = useAuthStore.getState();
        await acceptPendingInvite();

        await loadTrees();
        startRealtime();
        // Re-open the most recently used tree (or virtual view). The API
        // returns both lists sorted by `last_opened`, newest first.
        const { selectedTree, trees, virtualViews, selectTree } =
          useTreeStore.getState();
        const nextTree = trees[0] ?? virtualViews[0];
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
  }, [status, userId, loadTrees]);

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

    if (status === "unauthenticated") {
      if (pendingPublicTreeId) {
        return <PublicTreeViewer treeId={pendingPublicTreeId} />;
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
