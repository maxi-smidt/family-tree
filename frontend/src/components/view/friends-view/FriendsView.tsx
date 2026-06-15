import { useEffect, useState } from "react";
import { ViewLayout } from "@/components/layout/ViewLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, Search, UserMinus, UserPlus, X } from "lucide-react";
import { useFriendStore } from "@/hooks/useFriendStore";
import { UserSearchResult } from "@/types/friend";
import { ApiError } from "@/services/api";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

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
          r.username === username ? { ...r, status: "pending" } : r,
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

  const statusLabel = (status: UserSearchResult["status"]) => {
    if (status === "accepted") return t("status-friends");
    if (status === "pending") return t("status-pending");
    if (status === "blocked") return t("status-blocked");
    return null;
  };

  return (
    <ViewLayout title={t("title")}>
      <div className="mx-auto max-w-2xl space-y-4">
        <p className="text-sm text-muted-foreground">{t("description")}</p>

        <Tabs defaultValue={incoming.length > 0 ? "requests" : "friends"}>
          <TabsList>
            <TabsTrigger value="friends">
              {t("tab-friends")}
              {friends.length > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {friends.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="requests">
              {t("tab-requests")}
              {incoming.length > 0 && (
                <Badge variant="default" className="ml-1">
                  {incoming.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="add">{t("tab-add")}</TabsTrigger>
          </TabsList>

          {/* Accepted friends */}
          <TabsContent value="friends" className="space-y-2">
            {friends.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t("no-friends")}
              </p>
            ) : (
              friends.map((f) => (
                <div
                  key={f.user_id}
                  className="flex items-center justify-between rounded-md border p-2"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{f.username}</span>
                    {f.full_name && (
                      <span className="text-xs text-muted-foreground">
                        {f.full_name}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => run(() => remove(f.user_id), "remove-error")}
                    title={t("unfriend")}
                  >
                    <UserMinus className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </TabsContent>

          {/* Incoming + outgoing pending requests */}
          <TabsContent value="requests" className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("incoming")}</p>
              {incoming.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("no-incoming")}
                </p>
              ) : (
                incoming.map((f) => (
                  <div
                    key={f.user_id}
                    className="flex items-center justify-between rounded-md border p-2"
                  >
                    <span className="text-sm font-medium">{f.username}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          run(() => accept(f.user_id), "accept-error")
                        }
                        title={t("accept")}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          run(() => decline(f.user_id), "decline-error")
                        }
                        title={t("decline")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">{t("outgoing")}</p>
              {outgoing.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("no-outgoing")}
                </p>
              ) : (
                outgoing.map((f) => (
                  <div
                    key={f.user_id}
                    className="flex items-center justify-between rounded-md border p-2"
                  >
                    <span className="text-sm font-medium">{f.username}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        run(() => remove(f.user_id), "remove-error")
                      }
                      title={t("cancel-request")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </TabsContent>

          {/* Search & add */}
          <TabsContent value="add" className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={t("search-placeholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {query.trim() && !searching && results.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                {t("no-results")}
              </p>
            )}
            <div className="space-y-2">
              {results.map((r) => {
                const label = statusLabel(r.status);
                return (
                  <div
                    key={r.user_id}
                    className="flex items-center justify-between rounded-md border p-2"
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{r.username}</span>
                      {r.full_name && (
                        <span className="text-xs text-muted-foreground">
                          {r.full_name}
                        </span>
                      )}
                    </div>
                    {label ? (
                      <Badge variant="secondary">{label}</Badge>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSend(r.username)}
                      >
                        <UserPlus className="h-4 w-4" />
                        {t("add")}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ViewLayout>
  );
};
