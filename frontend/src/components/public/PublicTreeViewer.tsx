import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import { Tree } from "@/types/tree";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useAuthStore } from "@/hooks/useAuthStore";

// Lazy so the tree-view bundle stays code-split (shared with the authenticated
// app's lazy import) rather than being pulled into the main entry chunk.
const FlowPanel = lazy(() =>
  import("@/components/view/tree-view/FlowPanel").then((m) => ({
    default: m.FlowPanel,
  })),
);

type ViewState = "loading" | "loaded" | "not-public" | "error";

interface Props {
  treeId: string;
}

/**
 * Anonymous, read-only view of a tree shared with `public_role = "viewer"`.
 * Boots the normal tree stores with the public tree (the backend reports
 * `role: "viewer"` for anonymous requests, so the canvas renders read-only)
 * and shows the real interactive React Flow tree in a chromeless shell — no
 * tabs, no sidebar, no editing. Member nodes are purely visual.
 */
export const PublicTreeViewer = ({ treeId }: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "public-tree" });
  const [state, setState] = useState<ViewState>("loading");
  const [treeName, setTreeName] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Probe access (anonymous succeeds only for public trees) and grab the
        // name before booting the canvas stores.
        const tree = await api.get<Tree>(`/trees/${treeId}`);
        if (cancelled) return;
        setTreeName(tree.name);
        await useTreeStore
          .getState()
          .selectTree({ id: tree.id, name: tree.name });
        if (cancelled) return;
        setState("loaded");
      } catch (err: unknown) {
        if (cancelled) return;
        const status = (err as { status?: number })?.status;
        setState(status === 401 || status === 403 ? "not-public" : "error");
      }
    })();
    return () => {
      cancelled = true;
      // Tear the loaded tree back down so a subsequent login starts clean.
      void useTreeStore.getState().disconnect();
    };
  }, [treeId]);

  const handleLogin = () => {
    // Clearing pendingPublicTreeId lets the login page render; the user can
    // then sign in and open the tree normally.
    useAuthStore.setState({ pendingPublicTreeId: null });
  };

  if (state === "loading") {
    return (
      <div className="w-screen h-screen flex items-center justify-center">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (state === "not-public" || state === "error") {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-lg font-semibold">
          {state === "not-public" ? t("not-public") : t("error")}
        </p>
        <Button onClick={handleLogin}>{t("login-button")}</Button>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-background">
      <header className="flex-none border-b px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">{treeName}</h1>
          <p className="text-xs text-muted-foreground">{t("read-only-hint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button variant="outline" onClick={handleLogin}>
            {t("login-button")}
          </Button>
        </div>
      </header>
      <main className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="w-full h-full flex items-center justify-center">
              <Spinner className="size-8" />
            </div>
          }
        >
          <FlowPanel publicView />
        </Suspense>
      </main>
    </div>
  );
};
