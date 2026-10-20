import { ReactNode, useEffect, useState } from "react";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Check,
  Clock,
  MoreHorizontal,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
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

/** Consistent identity and actions across friends, requests and search hits. */
function PersonRow({
  avatar,
  name,
  username,
  actions,
  highlight = false,
}: {
  avatar: Pick<User, "first_name" | "last_name" | "profile_image_url">;
  name: string;
  username: string;
  actions: ReactNode;
  /** Soft accent background for items waiting on the user. */
  highlight?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5",
        highlight && "bg-primary-soft/50",
      )}
    >
      <AccountAvatar user={avatar} className="size-10 text-sm" />
      <div className="min-w-20 flex-1">
        <p className="truncate text-sm font-semibold" title={name}>
          {name}
        </p>
        <p
          className="truncate text-xs text-muted-foreground"
          title={`@${username}`}
        >
          @{username}
        </p>
      </div>
      <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center gap-1.5">
        {actions}
      </div>
    </li>
  );
}

export const FriendsView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.friends" });
  const friends = useFriendStore((s) => s.friends);
  const loading = useFriendStore((s) => s.loading);
  const incoming = useFriendStore((s) => s.incoming);
  const outgoing = useFriendStore((s) => s.outgoing);
  const loadAll = useFriendStore((s) => s.loadAll);
  const search = useFriendStore((s) => s.search);
  const sendRequest = useFriendStore((s) => s.sendRequest);
  const accept = useFriendStore((s) => s.accept);
  const decline = useFriendStore((s) => s.decline);
  const remove = useFriendStore((s) => s.remove);

  const [query, setQuery] = useState("");
  const [friendQuery, setFriendQuery] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [toUnfriend, setToUnfriend] = useState<Friend | null>(null);

  const refresh = () => {
    setLoadError(false);
    void loadAll().catch(() => setLoadError(true));
  };

  useEffect(() => {
    let active = true;
    void loadAll().catch(() => {
      if (active) setLoadError(true);
    });
    return () => {
      active = false;
    };
  }, [loadAll]);

  // Ignore stale responses when the query changes or is cleared.
  useEffect(() => {
    const term = query.trim();
    let active = true;
    setResults([]);
    setSearchError(false);
    setSearching(!!term);
    if (!term) return;
    const handle = setTimeout(() => {
      void search(term)
        .then((matches) => {
          if (active) setResults(matches);
        })
        .catch(() => {
          if (active) setSearchError(true);
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [query, search]);

  const filteredFriends = friends
    .filter((friend) =>
      `${friend.full_name ?? ""} ${friend.username}`
        .toLocaleLowerCase()
        .includes(friendQuery.trim().toLocaleLowerCase()),
    )
    .sort((a, b) =>
      (a.full_name || a.username).localeCompare(b.full_name || b.username),
    );

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
    <ViewLayout
      title={t("title")}
      subtitle={t("description")}
      contentClassName="overflow-hidden"
    >
      <div className="grid min-h-0 w-full max-w-6xl flex-1 grid-rows-[minmax(0,1fr)_fit-content(15rem)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[minmax(0,1fr)] lg:gap-8">
        <div className="flex min-h-0 min-w-0 flex-col gap-6">
          {loadError && (
            <div
              role="alert"
              className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm"
            >
              <p>{t("load-error")}</p>
              <Button variant="outline" size="sm" onClick={refresh}>
                {t("retry")}
              </Button>
            </div>
          )}
          {incoming.length > 0 && (
            <PageSection
              title={t("incoming")}
              count={incoming.length}
              className="flex min-h-0 max-h-[35%] shrink flex-col gap-3 space-y-0 [&>h2]:shrink-0"
            >
              <Card className="min-h-0 gap-0 overflow-hidden py-0 shadow-none">
                <ul
                  className="min-h-0 divide-y overflow-y-auto overscroll-y-contain"
                  aria-label={t("incoming")}
                  tabIndex={0}
                >
                  {incoming.map((f) => (
                    <PersonRow
                      key={f.user_id}
                      highlight
                      avatar={f}
                      name={f.full_name || f.username}
                      username={f.username}
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
                </ul>
              </Card>
            </PageSection>
          )}
          <PageSection
            title={t("your-friends")}
            count={friends.length}
            className="flex min-h-0 flex-1 flex-col gap-3 space-y-0 [&>h2]:shrink-0"
          >
            <Card className="min-h-0 gap-0 overflow-hidden py-0 shadow-none">
              {friends.length > 0 && (
                <div className="shrink-0 border-b p-3">
                  <SearchInput
                    aria-label={t("filter-placeholder")}
                    placeholder={t("filter-placeholder")}
                    value={friendQuery}
                    onChange={(event) => setFriendQuery(event.target.value)}
                    onClear={() => setFriendQuery("")}
                    className="border-transparent bg-muted/50 shadow-none focus-visible:bg-background"
                  />
                </div>
              )}
              {loading && friends.length === 0 ? (
                <div
                  role="status"
                  aria-label={t("loading")}
                  className="space-y-5 p-4"
                >
                  {[0, 1, 2].map((row) => (
                    <div key={row} className="flex items-center gap-3">
                      <Skeleton className="size-10 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : friends.length === 0 ? (
                <Empty className="py-12">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Users />
                    </EmptyMedia>
                    <EmptyTitle>{t("no-friends")}</EmptyTitle>
                    <EmptyDescription>{t("no-friends-hint")}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : filteredFriends.length === 0 ? (
                <p
                  role="status"
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  {t("no-matching-friends")}
                </p>
              ) : (
                <ul
                  className="min-h-0 divide-y overflow-y-auto overscroll-y-contain"
                  aria-label={t("your-friends")}
                  tabIndex={0}
                >
                  {filteredFriends.map((f) => (
                    <PersonRow
                      key={f.user_id}
                      avatar={f}
                      name={f.full_name || f.username}
                      username={f.username}
                      actions={
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground"
                              aria-label={t("friend-actions", {
                                name: f.full_name || f.username,
                              })}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setToUnfriend(f)}
                            >
                              <UserMinus />
                              {t("unfriend")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      }
                    />
                  ))}
                </ul>
              )}
            </Card>
          </PageSection>
        </div>
        <div className="min-h-0 min-w-0 space-y-6 overflow-y-auto overscroll-y-contain">
          <PageSection title={t("tab-add")} data-tutorial="add-friend">
            <Card className="gap-4 p-4 shadow-none">
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                  <UserPlus className="size-5" />
                </span>
                <p className="text-sm text-muted-foreground">
                  {t("search-hint")}
                </p>
              </div>
              <SearchInput
                aria-label={t("search-placeholder")}
                placeholder={t("search-placeholder")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery("")}
              />
              {searching ? (
                <p
                  role="status"
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <Spinner className="size-4" />
                  {t("searching")}
                </p>
              ) : searchError ? (
                <p role="alert" className="text-sm text-destructive">
                  {t("search-error")}
                </p>
              ) : query.trim() && results.length === 0 ? (
                <p role="status" className="text-sm text-muted-foreground">
                  {t("no-results")}
                </p>
              ) : (
                results.length > 0 && (
                  <ul
                    className="-mx-4 max-h-80 divide-y overflow-y-auto overscroll-y-contain border-t"
                    aria-label={t("search-results")}
                  >
                    {results.map((r) => (
                      <PersonRow
                        key={r.user_id}
                        avatar={{
                          first_name: null,
                          last_name: null,
                          profile_image_url: null,
                        }}
                        name={r.full_name || r.username}
                        username={r.username}
                        actions={searchAction(r)}
                      />
                    ))}
                  </ul>
                )
              )}
            </Card>
          </PageSection>
          {outgoing.length > 0 && (
            <PageSection title={t("outgoing")} count={outgoing.length}>
              <Card className="gap-0 overflow-hidden py-0 shadow-none">
                <ul
                  className="max-h-64 divide-y overflow-y-auto overscroll-y-contain"
                  aria-label={t("outgoing")}
                  tabIndex={0}
                >
                  {outgoing.map((f) => (
                    <PersonRow
                      key={f.user_id}
                      avatar={f}
                      name={f.full_name || f.username}
                      username={f.username}
                      actions={
                        <>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="size-3" />
                            {t("status-pending")}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("cancel-request-for", {
                              name: f.full_name || f.username,
                            })}
                            title={t("cancel-request")}
                            onClick={() =>
                              run(() => remove(f.user_id), "remove-error")
                            }
                          >
                            <X />
                          </Button>
                        </>
                      }
                    />
                  ))}
                </ul>
              </Card>
            </PageSection>
          )}
        </div>
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
