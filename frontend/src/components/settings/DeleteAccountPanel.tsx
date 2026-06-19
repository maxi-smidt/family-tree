import { useEffect, useState } from "react";
import { formatDate } from "@/utils/dateUtils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Trash2 } from "lucide-react";
import { api, ApiError } from "@/services/api";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/hooks/useAuthStore";
import { ShareCandidate, Tree, TreeAccess } from "@/types/tree";

type TransferState = {
  targets: Array<{ user_id: string; username: string }>;
  targetsLoaded: boolean;
  selected: string;
  transferred: boolean;
  transferredTo: string;
  transferring: boolean;
};

const defaultTransferState = (): TransferState => ({
  targets: [],
  targetsLoaded: false,
  selected: "",
  transferred: false,
  transferredTo: "",
  transferring: false,
});

export function DeleteAccountPanel() {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.delete-account" });
  const user = useAuthStore((s) => s.user);
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const logout = useAuthStore((s) => s.logout);

  const [ownedTrees, setOwnedTrees] = useState<Tree[]>([]);
  const [transferStates, setTransferStates] = useState<
    Record<string, TransferState>
  >({});
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get<Tree[]>("/trees").then((trees) => {
      const owned = trees.filter((t) => t.role === "owner");
      setOwnedTrees(owned);
      setTransferStates(
        Object.fromEntries(owned.map((t) => [t.id, defaultTransferState()])),
      );
    });
  }, []);

  const loadTargets = async (treeId: string) => {
    const state = transferStates[treeId];
    if (!state || state.targetsLoaded) return;

    const [accessList, candidates] = await Promise.all([
      api.get<TreeAccess[]>(`/trees/${treeId}/access`),
      api.get<ShareCandidate[]>(`/trees/${treeId}/access/candidates`),
    ]);
    const targets = [
      ...accessList
        .filter((a) => a.role !== "owner")
        .map((a) => ({ user_id: a.user_id, username: a.username })),
      ...candidates,
    ].sort((a, b) => a.username.localeCompare(b.username));

    setTransferStates((prev) => ({
      ...prev,
      [treeId]: { ...prev[treeId], targets, targetsLoaded: true },
    }));
  };

  const handleTransfer = async (treeId: string) => {
    const state = transferStates[treeId];
    if (!state?.selected) return;
    setTransferStates((prev) => ({
      ...prev,
      [treeId]: { ...prev[treeId], transferring: true },
    }));
    try {
      await api.post(`/trees/${treeId}/transfer`, { username: state.selected });
      setTransferStates((prev) => ({
        ...prev,
        [treeId]: {
          ...prev[treeId],
          transferred: true,
          transferredTo: state.selected,
          transferring: false,
        },
      }));
    } catch (err) {
      console.error(err);
      toast.error(t("transfer-error"));
      setTransferStates((prev) => ({
        ...prev,
        [treeId]: { ...prev[treeId], transferring: false },
      }));
    }
  };

  const treesWillDelete = ownedTrees.filter(
    (tree) => !transferStates[tree.id]?.transferred,
  );

  const handleSubmit = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const isLocal = user.auth_provider === "local";
      const result = await deleteAccount(
        isLocal ? confirmation : null,
        isLocal ? null : confirmation,
      );
      const date = result.deletion_scheduled_for
        ? formatDate(result.deletion_scheduled_for)
        : "";
      logout();
      toast.info(t("scheduled", { date }), { duration: 10000 });
    } catch (err) {
      console.error(err);
      const isLastAdmin =
        err instanceof ApiError && err.message === "cannot_delete_last_admin";
      toast.error(isLastAdmin ? t("last-admin-error") : t("error"));
      setLoading(false);
    }
  };

  if (!user) return null;

  const isLocal = user.auth_provider === "local";

  return (
    <div className="space-y-4 max-w-md">
      <div>
        <p className="font-medium text-sm text-destructive">{t("title")}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("description")}
        </p>
      </div>

      {ownedTrees.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">{t("owned-trees-label")}</p>
          <div className="space-y-2">
            {ownedTrees.map((tree) => {
              const state = transferStates[tree.id];
              if (!state) return null;
              return (
                <div key={tree.id} className="space-y-2 rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {tree.name}
                    </span>
                    {state.transferred && (
                      <Badge variant="secondary" className="shrink-0">
                        {t("transferred-to", {
                          username: state.transferredTo,
                        })}
                      </Badge>
                    )}
                  </div>
                  {!state.transferred && (
                    <div className="flex items-center gap-2">
                      <Select
                        value={state.selected}
                        onValueChange={(v) =>
                          setTransferStates((prev) => ({
                            ...prev,
                            [tree.id]: { ...prev[tree.id], selected: v },
                          }))
                        }
                        onOpenChange={(open) => {
                          if (open) void loadTargets(tree.id);
                        }}
                      >
                        <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
                          <SelectValue placeholder={t("transfer-select")} />
                        </SelectTrigger>
                        <SelectContent>
                          {!state.targetsLoaded ? (
                            <SelectItem value="__loading__" disabled>
                              {t("loading")}
                            </SelectItem>
                          ) : state.targets.length === 0 ? (
                            <SelectItem value="__none__" disabled>
                              {t("transfer-no-targets")}
                            </SelectItem>
                          ) : (
                            state.targets.map((target) => (
                              <SelectItem
                                key={target.user_id}
                                value={target.username}
                              >
                                {target.username}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0"
                        disabled={!state.selected || state.transferring}
                        onClick={() => void handleTransfer(tree.id)}
                      >
                        <ArrowRight className="h-3 w-3" />
                        {t("transfer-btn")}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {treesWillDelete.length > 0 && (
            <p className="text-sm text-destructive">
              {t("trees-warning", { count: treesWillDelete.length })}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <FieldLabel htmlFor="delete-confirmation">
          {isLocal ? t("password-label") : t("username-label")}
        </FieldLabel>
        <Input
          id="delete-confirmation"
          type={isLocal ? "password" : "text"}
          autoComplete={isLocal ? "current-password" : "username"}
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
      </div>

      <Button
        variant="destructive"
        disabled={!confirmation || loading}
        onClick={() => void handleSubmit()}
      >
        <Trash2 className="h-4 w-4" />
        {t("confirm")}
      </Button>
    </div>
  );
}
