import { useCallback, useEffect, useState } from "react";
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
import { Check, ChevronsUpDown, UserPlus, X } from "lucide-react";
import { api } from "@/services/api";
import { cn } from "@/lib/utils";
import {
  Database,
  ShareCandidate,
  ShareRole,
  TreeAccess,
} from "@/types/database";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Props = {
  tree: Database;
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

  return (
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
                      <SelectItem value="editor">{t("role-editor")}</SelectItem>
                      <SelectItem value="viewer">{t("role-viewer")}</SelectItem>
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
      </DialogContent>
    </Dialog>
  );
};
