import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Switch } from "@/components/ui/switch";
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
import {
  Check,
  ChevronsUpDown,
  Copy,
  Crown,
  Globe,
  Link,
  UserPlus,
  X,
} from "lucide-react";
import { TreeSharingService } from "@/services/TreeSharingService";
import { cn } from "@/lib/utils";
import {
  ShareCandidate,
  ShareRole,
  Tree,
  TreeAccess,
  TreeInvitation,
} from "@/types/tree";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useFeature } from "@/hooks/useAuthStore";

type Props = {
  tree: Tree;
  isOpen: boolean;
  onClose: () => void;
  onTreeUpdated?: (tree: Tree) => void;
};

type StagedUser = ShareCandidate & { role: ShareRole };

export const ShareTreeDialog = ({
  tree,
  isOpen,
  onClose,
  onTreeUpdated,
}: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "dialog.share-tree" });
  const sharingInvitesEnabled = useFeature("sharing_invites");
  const isOwner = tree.role === "owner";

  const [access, setAccess] = useState<TreeAccess[]>([]);
  const [candidates, setCandidates] = useState<ShareCandidate[]>([]);
  const [staged, setStaged] = useState<StagedUser[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [confirmTransferOpen, setConfirmTransferOpen] = useState(false);

  // Invitations state
  const [invitations, setInvitations] = useState<TreeInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ShareRole>("editor");
  const [inviteExpiry, setInviteExpiry] = useState<string>("never");
  const [creatingInvite, setCreatingInvite] = useState(false);

  // Public access state
  const [publicRole, setPublicRole] = useState<"viewer" | null>(
    tree.public_role ?? null,
  );
  const [confirmPublicOpen, setConfirmPublicOpen] = useState(false);
  const [pendingPublicRole, setPendingPublicRole] = useState<
    "viewer" | null
  >(null);

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
    const data = await TreeSharingService.getSharingData(tree.id);
    setAccess(data.access);
    setCandidates(data.candidates);

    if (sharingInvitesEnabled && isOwner) {
      const invs = await TreeSharingService.listInvitations(tree.id);
      setInvitations(invs);
    }
  }, [tree.id, sharingInvitesEnabled, isOwner]);

  useEffect(() => {
    if (isOpen) {
      setStaged([]);
      setTransferTo("");
      setInviteEmail("");
      setInviteRole("editor");
      setInviteExpiry("never");
      setPublicRole(tree.public_role ?? null);
      void reload();
    }
  }, [isOpen, reload, tree.public_role]);

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
      for (const s of staged) {
        await TreeSharingService.grantAccess(tree.id, s.username, s.role);
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
      const updated = await TreeSharingService.grantAccess(
        tree.id,
        member.username,
        role,
      );
      setAccess(updated);
    } catch (err) {
      console.error(err);
      toast.error(t("share-error"));
    }
  };

  const handleRevoke = async (userId: string) => {
    try {
      await TreeSharingService.revokeAccess(tree.id, userId);
      await reload();
    } catch (err) {
      console.error(err);
      toast.error(t("revoke-error"));
    }
  };

  const handleTransfer = async () => {
    try {
      await TreeSharingService.transferOwnership(tree.id, transferTo);
      setConfirmTransferOpen(false);
      setTransferTo("");
      toast.success(t("transfer-success"));
      onClose();
    } catch (err) {
      console.error(err);
      toast.error(t("transfer-error"));
    }
  };

  const handleCreateInvite = async () => {
    setCreatingInvite(true);
    try {
      const expiresInDays =
        inviteExpiry === "never"
          ? undefined
          : inviteExpiry === "7"
            ? 7
            : 30;
      await TreeSharingService.createInvitation(tree.id, {
        email: inviteEmail || undefined,
        role: inviteRole,
        expiresInDays,
      });
      setInviteEmail("");
      setInviteRole("editor");
      setInviteExpiry("never");
      await reload();
    } catch (err) {
      console.error(err);
      toast.error(t("invites.create-error"));
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleRevokeInvite = async (invitationId: string) => {
    try {
      await TreeSharingService.revokeInvitation(tree.id, invitationId);
      await reload();
    } catch (err) {
      console.error(err);
      toast.error(t("invites.revoke-error"));
    }
  };

  const handleCopyLink = (token: string) => {
    const url = `${window.location.origin}/#invite=${token}`;
    void navigator.clipboard.writeText(url);
    toast.success(t("invites.link-copied"));
  };

  const handlePublicToggle = (checked: boolean) => {
    setPendingPublicRole(checked ? "viewer" : null);
    setConfirmPublicOpen(true);
  };

  const handlePublicConfirm = async () => {
    try {
      const updated = await TreeSharingService.setPublicAccess(
        tree.id,
        pendingPublicRole,
      );
      setPublicRole(updated.public_role ?? null);
      onTreeUpdated?.(updated);
      setConfirmPublicOpen(false);
    } catch (err) {
      console.error(err);
      toast.error(t("public.error"));
      setConfirmPublicOpen(false);
    }
  };

  const inviteStatusBadge = (status: TreeInvitation["status"]) => {
    const variants: Record<
      TreeInvitation["status"],
      "default" | "secondary" | "destructive" | "outline"
    > = {
      pending: "default",
      accepted: "secondary",
      revoked: "destructive",
      expired: "outline",
    };
    return (
      <Badge variant={variants[status]}>{t(`invites.status-${status}`)}</Badge>
    );
  };

  const publicLink = `${window.location.origin}/#tree=${tree.id}`;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
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
                      onValueChange={(v) =>
                        handleRoleChange(a, v as ShareRole)
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

          {/* Invite by link (owner only, feature-gated) */}
          {sharingInvitesEnabled && isOwner && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center gap-2">
                <Link className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">{t("invites.title")}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("invites.description")}
              </p>

              {/* Create invite form */}
              <div className="space-y-2">
                <Input
                  placeholder={t("invites.email-placeholder")}
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  type="email"
                />
                <div className="flex gap-2">
                  <Select
                    value={inviteRole}
                    onValueChange={(v) => setInviteRole(v as ShareRole)}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="editor">{t("role-editor")}</SelectItem>
                      <SelectItem value="viewer">{t("role-viewer")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={inviteExpiry} onValueChange={setInviteExpiry}>
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="never">
                        {t("invites.expiry-never")}
                      </SelectItem>
                      <SelectItem value="7">
                        {t("invites.expiry-7d")}
                      </SelectItem>
                      <SelectItem value="30">
                        {t("invites.expiry-30d")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={handleCreateInvite}
                  disabled={creatingInvite}
                >
                  {t("invites.create-button")}
                </Button>
              </div>

              {/* Existing invitations */}
              {invitations.length > 0 ? (
                <div className="space-y-2">
                  {invitations.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between rounded-md border p-2 text-sm"
                    >
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {inviteStatusBadge(inv.status)}
                          <span className="text-xs text-muted-foreground capitalize">
                            {inv.role}
                          </span>
                          {inv.email && (
                            <span className="text-xs text-muted-foreground truncate">
                              {inv.email}
                            </span>
                          )}
                        </div>
                        {inv.expires_at && inv.status === "pending" && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(inv.expires_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {inv.token && inv.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopyLink(inv.token!)}
                            title={t("invites.copy-link")}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        )}
                        {inv.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRevokeInvite(inv.id)}
                            title={t("invites.revoke")}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("invites.none-yet")}
                </p>
              )}
            </div>
          )}

          {/* Public access (owner only, feature-gated) */}
          {sharingInvitesEnabled && isOwner && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium">{t("public.title")}</p>
                </div>
                <Switch
                  checked={publicRole === "viewer"}
                  onCheckedChange={handlePublicToggle}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("public.hint")}
              </p>
              {publicRole === "viewer" && (
                <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2">
                  <span className="flex-1 truncate text-xs text-muted-foreground">
                    {publicLink}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(publicLink);
                      toast.success(t("invites.link-copied"));
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}

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

      {/* Transfer confirmation */}
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

      {/* Public access confirmation */}
      <AlertDialog
        open={confirmPublicOpen}
        onOpenChange={setConfirmPublicOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingPublicRole === "viewer"
                ? t("public.confirm-enable-title")
                : t("public.confirm-disable-title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingPublicRole === "viewer"
                ? t("public.confirm-enable-description")
                : t("public.confirm-disable-description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("transfer-confirm-cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handlePublicConfirm}>
              {pendingPublicRole === "viewer"
                ? t("public.enable")
                : t("public.disable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
