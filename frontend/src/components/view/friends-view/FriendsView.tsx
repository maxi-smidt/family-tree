import { ReactNode, useEffect, useState } from "react";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Check, Clock, UserMinus, UserPlus, Users, X } from "lucide-react";
import { SearchInput } from "@/components/shared/SearchInput";
import { PageSection } from "@/components/shared/PageSection";
import { cn } from "@/lib/utils";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { AccountAvatar } from "@/components/auth/AccountAvatar";
import { useFriendStore } from "@/hooks/useFriendStore";
import { Friend, UserSearchResult } from "@/types/friend";
import type { User } from "@/types/user";
import { ApiError } from "@/services/api";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

/** Avatar + name/subtitle row with trailing actions, used across all tabs. */
function PersonCard({
  avatar,
  name,
  subtitle,
  actions,
  highlight = false,
}: {
  avatar: Pick<User, "first_name" | "last_name" | "profile_image_url">;
  name: string;
  subtitle?: string | null;
  actions: ReactNode;
  /** Soft accent background for items waiting on the user. */
  highlight?: boolean;
}) {
  return (
    <Card
      className={cn(
        "flex-row items-center gap-3 px-4 py-3.5",
        highlight && "border-transparent bg-primary-soft shadow-none",
      )}
    >
      <AccountAvatar user={avatar} className="size-10 text-sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{name}</p>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
    </Card>
  );
}

const GRID = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3";

export const FriendsView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.friends" });
  const friends = useFriendStore((s) => s.friends);
  const incoming = useFriendStore((s) => s.incoming);
  const outgoing = useFriendStore((s) => s.outgoing);
  const loadAll = useFriendStore((s) => s.loadAll);
  const search = useFriendStore((s) => s.search);
  const sendRequest = useFriendStore((s) => s.sendRequest);
  const accept = useFriendStore((s) => s.accept);
  const decline = useFriendStore((s) => s.decline);
  const remove = useFriendStore((s) => s.remove);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [toUnfriend, setToUnfriend] = useState<Friend | null>(null);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Debounced username search.
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      void search(term)
        .then(setResults)
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [query, search]);

  const run = async (action: () => Promise<void>, errorKey: string) => {
    try {
      await action();
    } catch (err) {
      console.error(err);
      toast.error(t(errorKey));
    }
  };

  const handleSend = async (username: string) => {
    try {
      await sendRequest(username);
      toast.success(t("request-sent"));
      // Reflect the new relationship in the open search results.
      setResults((prev) =>
        prev.map((r) =>
          r.username === username
            ? { ...r, status: "pending", direction: "outgoing" }
            : r,
        ),
      );
    } catch (err) {
      console.error(err);
      toast.error(
        err instanceof ApiError && err.status === 403
          ? t("blocked-error")
          : t("send-error"),
      );
    }
  };

  const patchResult = (userId: string, patch: Partial<UserSearchResult>) =>
    setResults((prev) =>
      prev.map((r) => (r.user_id === userId ? { ...r, ...patch } : r)),
    );

  // The trailing control for a search hit depends on our relationship: send,
  // accept an incoming request, revoke an outgoing one, or just label it.
  const searchAction = (r: UserSearchResult): ReactNode => {
    if (r.status === "accepted") {
      return <Badge variant="secondary">{t("status-friends")}</Badge>;
    }
    if (r.status === "blocked") {
      return <Badge variant="secondary">{t("status-blocked")}</Badge>;
    }
    if (r.status === "pending" && r.direction === "incoming") {
      return (
        <Button
          variant="default"
          size="sm"
          onClick={() =>
            run(async () => {
              await accept(r.user_id);
              patchResult(r.user_id, { status: "accepted", direction: null });
            }, "accept-error")
          }
        >
          <Check className="h-4 w-4" />
          {t("accept")}
        </Button>
      );
    }
    if (r.status === "pending") {
      return (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() =>
            run(async () => {
              await remove(r.user_id);
              patchResult(r.user_id, { status: null, direction: null });
            }, "remove-error")
          }
        >
          <X className="h-4 w-4" />
          {t("cancel-request")}
        </Button>
      );
    }
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleSend(r.username)}
      >
        <UserPlus className="h-4 w-4" />
        {t("add")}
      </Button>
    );
  };

  return (
    <ViewLayout title={t("title")} subtitle={t("description")}>
      <div className="flex max-w-5xl flex-col gap-8 px-1 pb-4">
        {incoming.length > 0 && (
          <PageSection title={t("incoming")}>
            <div className="flex flex-col gap-2">
              {incoming.map((f) => (
                <PersonCard
                  key={f.user_id}
                  highlight
                  avatar={f}
                  name={f.username}
                  subtitle={f.full_name}
                  actions={
                    <>
                      <Button
                        size="sm"
                        onClick={() =>
                          run(() => accept(f.user_id), "accept-error")
                        }
                      >
                        <Check />
                        {t("accept")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          run(() => decline(f.user_id), "decline-error")
                        }
                      >
                        {t("decline")}
                      </Button>
                    </>
                  }
                />
              ))}
            </div>
          </PageSection>
        )}

        <PageSection title={t("tab-add")} data-tutorial="add-friend">
          <Card className="gap-3 px-4 py-4">
            <SearchInput
              placeholder={t("search-placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery("")}
            />
            {query.trim() && !searching && results.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">
                {t("no-results")}
              </p>
            ) : (
              results.length > 0 && (
                <ul className="divide-y">
                  {results.map((r) => (
                    <li
                      key={r.user_id}
                      className="flex items-center gap-3 py-2.5"
                    >
                      <AccountAvatar
                        user={{
                          first_name: null,
                          last_name: null,
                          profile_image_url: null,
                        }}
                        className="size-8 text-xs"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {r.username}
                        </p>
                        {r.full_name && (
                          <p className="truncate text-xs text-muted-foreground">
                            {r.full_name}
                          </p>
                        )}
                      </div>
                      {searchAction(r)}
                    </li>
                  ))}
                </ul>
              )
            )}
          </Card>
        </PageSection>

        <PageSection title={t("your-friends")} count={friends.length}>
          {friends.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Users />
                </EmptyMedia>
                <EmptyTitle>{t("no-friends")}</EmptyTitle>
                <EmptyDescription>{t("no-friends-hint")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className={GRID}>
              {friends.map((f) => (
                <PersonCard
                  key={f.user_id}
                  avatar={f}
                  name={f.username}
                  subtitle={f.full_name}
                  actions={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
                      onClick={() => setToUnfriend(f)}
                      title={t("unfriend")}
                      aria-label={t("unfriend")}
                    >
                      <UserMinus />
                    </Button>
                  }
                />
              ))}
            </div>
          )}
        </PageSection>

        {outgoing.length > 0 && (
          <PageSection title={t("outgoing")}>
            <Card className="gap-0 py-0">
              <ul className="divide-y">
                {outgoing.map((f) => (
                  <li
                    key={f.user_id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <AccountAvatar user={f} className="size-8 text-xs" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {f.username}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {t("status-pending")}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        run(() => remove(f.user_id), "remove-error")
                      }
                    >
                      <X />
                      {t("cancel-request")}
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          </PageSection>
        )}
      </div>

      <ConfirmDeleteDialog
        open={toUnfriend !== null}
        onOpenChange={(open) => !open && setToUnfriend(null)}
        onConfirm={() => {
          if (toUnfriend) {
            void run(() => remove(toUnfriend.user_id), "remove-error");
          }
          setToUnfriend(null);
        }}
        title={t("confirm-remove-title")}
        description={t("confirm-remove-description", {
          name: toUnfriend?.username ?? "",
        })}
        cancelText={t("confirm-remove-cancel")}
        confirmText={t("confirm-remove-confirm")}
      />
    </ViewLayout>
  );
};
