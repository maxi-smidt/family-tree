import { useEffect, useState } from "react";
import { api } from "@/services/api";
import { Tree } from "@/types/tree";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface PublicMember {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  maidenName?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  dateOfDeath?: string | null;
}

type ViewState = "loading" | "loaded" | "not-public" | "error";

interface Props {
  treeId: string;
}

export const PublicTreeViewer = ({ treeId }: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "public-tree" });
  const [state, setState] = useState<ViewState>("loading");
  const [tree, setTree] = useState<Tree | null>(null);
  const [members, setMembers] = useState<PublicMember[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [treeData, membersData] = await Promise.all([
          api.get<Tree>(`/trees/${treeId}`),
          api.get<PublicMember[]>(`/trees/${treeId}/members`),
        ]);
        setTree(treeData);
        setMembers(membersData);
        setState("loaded");
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status;
        if (status === 401 || status === 403) {
          setState("not-public");
        } else {
          setState("error");
        }
      }
    })();
  }, [treeId]);

  const handleLogin = () => {
    // Clear the pendingPublicTreeId so the login page renders, then the user
    // can log in and navigate to the tree normally.
    import("@/hooks/useAuthStore").then(({ useAuthStore }) => {
      useAuthStore.setState({ pendingPublicTreeId: null });
    });
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

  const fullName = (m: PublicMember) =>
    [m.firstName, m.maidenName ? `(${m.maidenName})` : null, m.lastName]
      .filter(Boolean)
      .join(" ") || t("unnamed");

  const genderLabel = (g: string | null | undefined) => {
    if (g === "m") return t("gender-male");
    if (g === "f") return t("gender-female");
    return null;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{tree?.name}</h1>
          <p className="text-sm text-muted-foreground">{t("read-only-hint")}</p>
        </div>
        <Button variant="outline" onClick={handleLogin}>
          {t("login-button")}
        </Button>
      </header>

      <main className="p-6">
        <p className="text-sm text-muted-foreground mb-4">
          {t("member-count", { count: members.length })}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {members.map((m) => (
            <div
              key={m.id}
              className="rounded-md border p-3 space-y-1 bg-card"
            >
              <p className="font-medium text-sm leading-tight">{fullName(m)}</p>
              {genderLabel(m.gender) && (
                <p className="text-xs text-muted-foreground">
                  {genderLabel(m.gender)}
                </p>
              )}
              {m.dateOfBirth && (
                <p className="text-xs text-muted-foreground">
                  ✦ {m.dateOfBirth}
                  {m.dateOfDeath ? ` – ${m.dateOfDeath}` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};
