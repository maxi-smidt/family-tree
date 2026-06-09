import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { api } from "@/services/api";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/hooks/useAuthStore";
import { ShareCandidate, Tree, TreeAccess } from "@/types/tree";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

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

export const DeleteAccountDialog = ({ isOpen, onClose }: Props) => {
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

  const resetForm = () => {
    setOwnedTrees([]);
    setTransferStates({});
    setConfirmation("");
    setLoading(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    api.get<Tree[]>("/trees").then((trees) => {
      const owned = trees.filter((t) => t.role === "owner");
      setOwnedTrees(owned);
      setTransferStates(
        Object.fromEntries(owned.map((t) => [t.id, defaultTransferState()])),
      );
    });
  }, [isOpen]);

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
        ? new Date(result.deletion_scheduled_for).toLocaleDateString()
        : "";
      logout();
      toast.info(t("scheduled", { date }), { duration: 10000 });
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(t("error"));
      setLoading(false);
    }
  };

  if (!user) return null;

  const isLocal = user.auth_provider === "local";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {ownedTrees.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{t("owned-trees-label")}</p>
              <div className="space-y-2">
                {ownedTrees.map((tree) => {
                  const state = transferStates[tree.id];
                  if (!state) return null;
                  return (
                    <div
                      key={tree.id}
                      className="flex items-center gap-2 rounded-md border p-3"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {tree.name}
                      </span>
                      {state.transferred ? (
                        <Badge variant="secondary" className="shrink-0">
                          {t("transferred-to", {
                            username: state.transferredTo,
                          })}
                        </Badge>
                      ) : (
                        <div className="flex shrink-0 items-center gap-2">
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
                            <SelectTrigger className="h-8 w-36 text-xs">
                              <SelectValue
                                placeholder={t("transfer-select")}
                              />
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
                            className="h-8"
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
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={handleClose}>
            {t("cancel")}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={!confirmation || loading}
          >
            <Trash2 className="h-4 w-4" />
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
