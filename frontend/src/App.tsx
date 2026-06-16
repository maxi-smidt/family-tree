import "./App.css";
import { useEffect } from "react";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useAdminViewStore } from "@/hooks/useAdminViewStore";
import { NoDatabasePlaceholder } from "@/components/layout/NoDatabasePlaceholder";
import { Layout } from "@/components/layout/Layout";
import { MainPanel } from "@/components/layout/MainPanel";
import { AdminView } from "@/components/admin/AdminView";
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
  const pendingPublicTreeId = useAuthStore((s) => s.pendingPublicTreeId);
  const loadTrees = useTreeStore((s) => s.loadTrees);
  const selectedTree = useTreeStore((s) => s.selectedTree);
  const adminOpen = useAdminViewStore((s) => s.open);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (status !== "authenticated") return;
    void (async () => {
      // Accept a pending invite (from an #invite= link) before loading trees so
      // the newly granted tree appears in the list immediately.
      const { acceptPendingInvite } = useAuthStore.getState();
      await acceptPendingInvite();

      await loadTrees();
      // Re-open the most recently used tree (the API returns them sorted by
      // last_opened, newest first) so the user lands back where they left off.
      const { selectedTree, trees, selectTree } = useTreeStore.getState();
      if (!selectedTree && trees.length > 0) {
        await selectTree(trees[0]);
      }
    })();
  }, [status, loadTrees]);

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

    return (
      <ErrorBoundary>
        <UnsavedChangesGuard />
        {adminOpen && user?.is_admin ? (
          <TooltipProvider delayDuration={500}>
            <AdminView />
          </TooltipProvider>
        ) : (
          <Layout>
            {selectedTree ? <MainPanel /> : <NoDatabasePlaceholder />}
          </Layout>
        )}
      </ErrorBoundary>
    );
  }
};
