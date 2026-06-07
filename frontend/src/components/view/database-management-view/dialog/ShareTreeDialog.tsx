import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Check, ChevronsUpDown, Crown, UserPlus, X } from "lucide-react";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import { Tree, ShareCandidate, ShareRole, TreeAccess } from "@/types/tree";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Props = {
  tree: Tree;
  isOpen: boolean;
  onClose: () => void;
};

type StagedUser = ShareCandidate & { role: ShareRole };

export const ShareTreeDialog = ({ tree, isOpen, onClose }: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "dialog.share-tree" });
  const [access, setAccess] = useState<TreeAccess[]>([]);
  const [candidates, setCandidates] = useState<ShareCandidate[]>([]);
  const [staged, setStaged] = useState<StagedUser[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [confirmTransferOpen, setConfirmTransferOpen] = useState(false);

  // Any active user other than the current owner is an eligible new owner:
  // existing members plus the share candidates (users without access yet).
  const transferTargets = useMemo(
    () =>
      [
        ...access
          .filter((a) => a.role !== "owner")
          .map((a) => ({ user_id: a.user_id, username: a.username })),
        ...candidates,
      ].sort((a, b) => a.username.localeCompare(b.username)),
    [access, candidates],
  );

  const reload = useCallback(async () => {
    const [members, available] = await Promise.all([
      api.get<TreeAccess[]>(`/trees/${tree.id}/access`),
      api.get<ShareCandidate[]>(`/trees/${tree.id}/access/candidates`),
    ]);
    setAccess(members);
    setCandidates(available);
  }, [tree.id]);

  useEffect(() => {
    if (isOpen) {
      setStaged([]);
      setTransferTo("");
      void reload();
    }
  }, [isOpen, reload]);

  const toggleStaged = (candidate: ShareCandidate) => {
    setStaged((prev) =>
      prev.some((s) => s.user_id === candidate.user_id)
        ? prev.filter((s) => s.user_id !== candidate.user_id)
        : [...prev, { ...candidate, role: "editor" }],
    );
  };

  const setStagedRole = (userId: string, role: ShareRole) => {
    setStaged((prev) =>
      prev.map((s) => (s.user_id === userId ? { ...s, role } : s)),
    );
  };

  const handleShare = async () => {
    try {
      // Each grant is an idempotent upsert keyed by username.
      for (const s of staged) {
        await api.post<TreeAccess[]>(`/trees/${tree.id}/access`, {
          username: s.username,
          role: s.role,
        });
      }
      setStaged([]);
      await reload();
      toast.success(t("shared"));
    } catch (err) {
      console.error(err);
      toast.error(t("share-error"));
    }
  };

  const handleRoleChange = async (member: TreeAccess, role: ShareRole) => {
    try {
      const updated = await api.post<TreeAccess[]>(`/trees/${tree.id}/access`, {
        username: member.username,
        role,
      });
      setAccess(updated);
    } catch (err) {
      console.error(err);
      toast.error(t("share-error"));
    }
  };

  const handleRevoke = async (userId: string) => {
    try {
      await api.del(`/trees/${tree.id}/access/${userId}`);
      await reload();
    } catch (err) {
      console.error(err);
      toast.error(t("revoke-error"));
    }
  };

  const handleTransfer = async () => {
    try {
      await api.post(`/trees/${tree.id}/transfer`, { username: transferTo });
      setConfirmTransferOpen(false);
      setTransferTo("");
      toast.success(t("transfer-success"));
      // Ownership (and possibly our own access) changed; close and let the
      // parent refetch the tree list.
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(t("transfer-error"));
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("title", { name: tree.name })}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          {/* People who already have access */}
          <div className="space-y-2">
            <p className="text-sm font-medium">{t("current-access")}</p>
            {access.map((a) => (
              <div
                key={a.user_id}
                className="flex items-center justify-between rounded-md border p-2"
              >
                <span className="text-sm font-medium">{a.username}</span>
                {a.role === "owner" ? (
                  <Badge variant="secondary">{t("role-owner")}</Badge>
                ) : (
                  <div className="flex items-center gap-2">
                    <Select
                      value={a.role}
                      onValueChange={(v) => handleRoleChange(a, v as ShareRole)}
                    >
                      <SelectTrigger className="h-8 w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">
                          {t("role-editor")}
                        </SelectItem>
                        <SelectItem value="viewer">
                          {t("role-viewer")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRevoke(a.user_id)}
                      title={t("revoke")}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Add new people */}
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">{t("add-people")}</p>

            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  className="w-full justify-between font-normal"
                  disabled={candidates.length === 0}
                >
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <UserPlus className="h-4 w-4" />
                    {candidates.length === 0
                      ? t("no-candidates")
                      : t("select-users")}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] p-0"
                align="start"
              >
                <Command>
                  <CommandInput placeholder={t("search-placeholder")} />
                  <CommandList>
                    <CommandEmpty>{t("no-users")}</CommandEmpty>
                    <CommandGroup>
                      {candidates.map((c) => {
                        const isStaged = staged.some(
                          (s) => s.user_id === c.user_id,
                        );
                        return (
                          <CommandItem
                            key={c.user_id}
                            value={c.username}
                            onSelect={() => toggleStaged(c)}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                isStaged ? "opacity-100" : "opacity-0",
                              )}
                            />
                            {c.username}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Staged users, each with its own role */}
            {staged.length > 0 && (
              <div className="space-y-2">
                {staged.map((s) => (
                  <div
                    key={s.user_id}
                    className="flex items-center justify-between rounded-md border border-dashed p-2"
                  >
                    <span className="text-sm font-medium">{s.username}</span>
                    <div className="flex items-center gap-2">
                      <Select
                        value={s.role}
                        onValueChange={(v) =>
                          setStagedRole(s.user_id, v as ShareRole)
                        }
                      >
                        <SelectTrigger className="h-8 w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="editor">
                            {t("role-editor")}
                          </SelectItem>
                          <SelectItem value="viewer">
                            {t("role-viewer")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleStaged(s)}
                        title={t("remove")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button className="w-full" onClick={handleShare}>
                  {t("share-button", { count: staged.length })}
                </Button>
              </div>
            )}
          </div>
          {/* Transfer ownership */}
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">{t("transfer-title")}</p>
            <p className="text-xs text-muted-foreground">
              {t("transfer-hint")}
            </p>
            <div className="flex items-center gap-2">
              <Select
                value={transferTo}
                onValueChange={setTransferTo}
                disabled={transferTargets.length === 0}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue
                    placeholder={
                      transferTargets.length === 0
                        ? t("transfer-no-targets")
                        : t("transfer-select")
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {transferTargets.map((u) => (
                    <SelectItem key={u.user_id} value={u.username}>
                      {u.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                disabled={!transferTo}
                onClick={() => setConfirmTransferOpen(true)}
              >
                <Crown className="h-4 w-4" />
                {t("transfer-button")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmTransferOpen}
        onOpenChange={setConfirmTransferOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("transfer-confirm-title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("transfer-confirm-description", {
                username: transferTo,
                name: tree.name,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("transfer-confirm-cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleTransfer}>
              {t("transfer-confirm-action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
