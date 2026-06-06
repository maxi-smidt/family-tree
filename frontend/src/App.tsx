import "./App.css";
import { useEffect } from "react";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useTreeStore } from "@/hooks/useTreeStore";
import { NoDatabasePlaceholder } from "@/components/layout/NoDatabasePlaceholder";
import { Layout } from "@/components/layout/Layout";
import { MainPanel } from "@/components/layout/MainPanel";
import { ErrorBoundary } from "@/components/layout/ErrorBoundary";
import { LoginPage } from "@/components/auth/LoginPage";
import { Spinner } from "@/components/ui/spinner";

export const App = () => {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);
  const loadTrees = useTreeStore((s) => s.loadTrees);
  const selectedTree = useTreeStore((s) => s.selectedTree);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (status !== "authenticated") return;
    void (async () => {
      await loadTrees();
      // Re-open the most recently used tree (the API returns them sorted by
      // last_opened, newest first) so the user lands back where they left off.
      const { selectedTree, trees, selectTree } = useTreeStore.getState();
      if (!selectedTree && trees.length > 0) {
        await selectTree(trees[0]);
      }
    })();
  }, [status, loadTrees]);

  if (status === "loading") {
    return (
      <div className="w-screen h-screen flex items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <LoginPage />;
  }

  return (
    <ErrorBoundary>
      <Layout>
        {selectedTree ? <MainPanel /> : <NoDatabasePlaceholder />}
      </Layout>
    </ErrorBoundary>
  );
};
