import { ReactNode, useEffect, useState } from "react";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
  Search,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
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
}: {
  avatar: Pick<User, "first_name" | "last_name" | "profile_image_url">;
  name: string;
  subtitle?: string | null;
  actions: ReactNode;
}) {
  return (
    <Card className="flex-row items-center gap-3 p-3">
      <AccountAvatar user={avatar} className="size-10 text-sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        {subtitle && (
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </Card>
  );
}

const GRID = "grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4";

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

  const [tab, setTab] = useState("friends");
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

  const tabBadge = (count: number, variant: "secondary" | "default") =>
    count > 0 ? (
      <Badge variant={variant} className="ml-1.5 px-1.5">
        {count}
      </Badge>
    ) : null;

  return (
    <ViewLayout title={t("title")}>
      {/* px-1 keeps focus rings (e.g. the search box) from being clipped by the
          ViewLayout scroll container's left edge. */}
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex h-full min-h-0 flex-1 flex-col px-1"
      >
        <TabsList>
          <TabsTrigger value="friends">
            {t("tab-friends")}
            {tabBadge(friends.length, "secondary")}
          </TabsTrigger>
          <TabsTrigger value="requests">
            {t("tab-requests")}
            {tabBadge(incoming.length, "default")}
          </TabsTrigger>
          <TabsTrigger value="add" data-tutorial="add-friend">
            {t("tab-add")}
          </TabsTrigger>
        </TabsList>

        {/* Accepted friends */}
        <TabsContent
          value="friends"
          className="mt-4 flex min-h-0 flex-1 flex-col"
        >
          {friends.length === 0 ? (
            <Empty className="flex-1 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Users />
                </EmptyMedia>
                <EmptyTitle>{t("no-friends")}</EmptyTitle>
                <EmptyDescription>{t("description")}</EmptyDescription>
              </EmptyHeader>
              <Button onClick={() => setTab("add")}>
                <UserPlus className="h-4 w-4" />
                {t("tab-add")}
              </Button>
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
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setToUnfriend(f)}
                      title={t("unfriend")}
                      aria-label={t("unfriend")}
                    >
                      <UserMinus className="h-4 w-4" />
                    </Button>
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Incoming + outgoing pending requests */}
        <TabsContent value="requests" className="mt-4 flex-1 space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t("incoming")}
            </h2>
            {incoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("no-incoming")}
              </p>
            ) : (
              <div className={GRID}>
                {incoming.map((f) => (
                  <PersonCard
                    key={f.user_id}
                    avatar={f}
                    name={f.username}
                    subtitle={f.full_name}
                    actions={
                      <>
                        <Button
                          variant="default"
                          size="icon"
                          onClick={() =>
                            run(() => accept(f.user_id), "accept-error")
                          }
                          title={t("accept")}
                          aria-label={t("accept")}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            run(() => decline(f.user_id), "decline-error")
                          }
                          title={t("decline")}
                          aria-label={t("decline")}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t("outgoing")}
            </h2>
            {outgoing.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("no-outgoing")}
              </p>
            ) : (
              <div className={GRID}>
                {outgoing.map((f) => (
                  <PersonCard
                    key={f.user_id}
                    avatar={f}
                    name={f.username}
                    subtitle={f.full_name}
                    actions={
                      <>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {t("status-pending")}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            run(() => remove(f.user_id), "remove-error")
                          }
                          title={t("cancel-request")}
                          aria-label={t("cancel-request")}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </TabsContent>

        {/* Search & add */}
        <TabsContent value="add" className="mt-4 flex-1 space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder={t("search-placeholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {query.trim() && !searching && results.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("no-results")}</p>
          ) : (
            <div className={GRID}>
              {results.map((r) => (
                <PersonCard
                  key={r.user_id}
                  avatar={{
                    first_name: null,
                    last_name: null,
                    profile_image_url: null,
                  }}
                  name={r.username}
                  subtitle={r.full_name}
                  actions={searchAction(r)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

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
