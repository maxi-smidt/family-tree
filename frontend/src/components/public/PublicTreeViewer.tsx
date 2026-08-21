import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ApiError, PUBLIC_PASSWORD_REQUIRED } from "@/services/api";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/shared/ThemeToggle";
import { useTreeStore } from "@/hooks/useTreeStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { LegalDocsDialog } from "@/components/legal/LegalDocsDialog";

// Lazy so the tree-view bundle stays code-split (shared with the authenticated
// app's lazy import) rather than being pulled into the main entry chunk.
const FlowPanel = lazy(() =>
  import("@/components/view/tree-view/FlowPanel").then((m) => ({
    default: m.FlowPanel,
  })),
);

type ViewState = "loading" | "loaded" | "not-public" | "password" | "error";

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
  const { t: tLegal } = useTranslation(undefined, { keyPrefix: "legal" });
  const [state, setState] = useState<ViewState>("loading");
  const [treeName, setTreeName] = useState("");
  const [legalDocsOpen, setLegalDocsOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(false);
  const openTreeById = useTreeStore((s) => s.openTreeById);
  const unlockPublicTree = useTreeStore((s) => s.unlockPublicTree);
  const disconnectPublicTree = useTreeStore((s) => s.disconnectPublicTree);
  // Guards against setState after unmount / a treeId change mid-flight;
  // load() is also invoked directly on unlock (outside the mount effect), so
  // a plain effect-scoped `cancelled` closure variable isn't enough here.
  const cancelledRef = useRef(false);

  const load = useCallback(async () => {
    try {
      // Probe access (anonymous succeeds only for public trees) and boot the
      // domain store. The store owns request scoping and tree initialization.
      const tree = await openTreeById(treeId);
      if (cancelledRef.current) return;
      setTreeName(tree.name);
      setState("loaded");
    } catch (err: unknown) {
      if (cancelledRef.current) return;
      if (
        err instanceof ApiError &&
        err.status === 401 &&
        err.message === PUBLIC_PASSWORD_REQUIRED
      ) {
        setState("password");
        return;
      }
      const status = (err as { status?: number })?.status;
      setState(status === 401 || status === 403 ? "not-public" : "error");
    }
  }, [treeId, openTreeById]);

  useEffect(() => {
    cancelledRef.current = false;
    void load();
    return () => {
      cancelledRef.current = true;
      // Tear the loaded tree back down so a subsequent login starts clean.
      void disconnectPublicTree();
    };
  }, [treeId, load, disconnectPublicTree]);

  const handleUnlock = async () => {
    setUnlocking(true);
    setUnlockError(false);
    try {
      const tree = await unlockPublicTree(treeId, password);
      if (!cancelledRef.current) {
        setTreeName(tree.name);
        setState("loaded");
      }
    } catch (err) {
      if (cancelledRef.current) return;
      if (err instanceof ApiError && err.status === 401) {
        setUnlockError(true);
      } else {
        setState("error");
      }
    } finally {
      if (!cancelledRef.current) setUnlocking(false);
    }
  };

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

  if (state === "password") {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-lg font-semibold">{t("password.title")}</p>
        <p className="text-sm text-muted-foreground max-w-sm">
          {t("password.description")}
        </p>
        <div className="flex w-full max-w-xs flex-col gap-2">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !unlocking && password) {
                void handleUnlock();
              }
            }}
            autoFocus
          />
          <Button
            onClick={() => void handleUnlock()}
            disabled={unlocking || !password}
          >
            {t("password.submit")}
          </Button>
          {unlockError && (
            <p className="text-sm text-destructive">{t("password.error")}</p>
          )}
        </div>
        <Button variant="outline" onClick={handleLogin}>
          {t("login-button")}
        </Button>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setLegalDocsOpen(true)}
        >
          {tLegal("legal-link-public")}
        </button>
        <LegalDocsDialog
          open={legalDocsOpen}
          onOpenChange={setLegalDocsOpen}
          showTerms={false}
        />
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
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setLegalDocsOpen(true)}
        >
          {tLegal("legal-link-public")}
        </button>
        <LegalDocsDialog
          open={legalDocsOpen}
          onOpenChange={setLegalDocsOpen}
          showTerms={false}
        />
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
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setLegalDocsOpen(true)}
          >
            {tLegal("legal-link-public")}
          </button>
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
      <LegalDocsDialog
        open={legalDocsOpen}
        onOpenChange={setLegalDocsOpen}
        showTerms={false}
      />
    </div>
  );
};
