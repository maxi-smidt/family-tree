import "./App.css";
import { useEffect } from "react";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useDatabaseStore } from "@/hooks/useDatabaseStore";
import { NoDatabasePlaceholder } from "@/components/layout/NoDatabasePlaceholder";
import { Layout } from "@/components/layout/Layout";
import { MainPanel } from "@/components/layout/MainPanel";
import { ErrorBoundary } from "@/components/layout/ErrorBoundary";
import { LoginPage } from "@/components/auth/LoginPage";
import { Spinner } from "@/components/ui/spinner";

export const App = () => {
  const status = useAuthStore((s) => s.status);
  const init = useAuthStore((s) => s.init);
  const loadTrees = useDatabaseStore((s) => s.loadTrees);
  const selectedDatabase = useDatabaseStore((s) => s.selectedDatabase);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (status !== "authenticated") return;
    void (async () => {
      await loadTrees();
      // Re-open the most recently used tree (the API returns them sorted by
      // last_opened, newest first) so the user lands back where they left off.
      const { selectedDatabase, databases, selectDatabase } =
        useDatabaseStore.getState();
      if (!selectedDatabase && databases.length > 0) {
        await selectDatabase(databases[0]);
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
        {selectedDatabase ? <MainPanel /> : <NoDatabasePlaceholder />}
      </Layout>
    </ErrorBoundary>
  );
};
