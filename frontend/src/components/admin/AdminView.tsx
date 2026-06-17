import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { FieldLabel } from "@/components/ui/field";
import { ConfirmDeleteDialog } from "@/components/shared/dialog/ConfirmDeleteDialog";
import { BackupPanel } from "@/components/admin/BackupPanel";
import { FeatureFlagsPanel } from "@/components/admin/FeatureFlagsPanel";
import { RelationTypesPanel } from "@/components/admin/RelationTypesPanel";
import { SessionExpiryBanner } from "@/components/layout/SessionExpiryBanner";
import { ArrowLeft, KeyRound, Plus, ShieldOff, Trash2, Undo2 } from "lucide-react";
import {
  AdminService,
  AdminSettings,
  AdminUserUpdate,
} from "@/services/AdminService";
import { User } from "@/types/user";
import { formatDate } from "@/utils/dateUtils";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useAdminViewStore } from "@/hooks/useAdminViewStore";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

export const AdminView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "admin" });
  const currentUser = useAuthStore((s) => s.user);
  const refreshConfig = useAuthStore((s) => s.refreshConfig);
  const closeAdmin = useAdminViewStore((s) => s.closeAdmin);

  const [users, setUsers] = useState<User[]>([]);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [userToReset, setUserToReset] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [userToResetTotp, setUserToResetTotp] = useState<User | null>(null);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    email: "",
    is_admin: false,
  });

  const loadUsers = useCallback(async () => {
    setUsers(await AdminService.listUsers());
  }, []);

  const loadSettings = useCallback(async () => {
    setSettings(await AdminService.getSettings());
  }, []);

  useEffect(() => {
    void loadUsers();
    void loadSettings();
  }, [loadUsers, loadSettings]);

  const handleCreateUser = async () => {
    try {
      await AdminService.createUser({
        username: newUser.username,
        password: newUser.password,
        email: newUser.email || null,
        is_admin: newUser.is_admin,
      });
      setNewUser({ username: "", password: "", email: "", is_admin: false });
      await loadUsers();
      toast.success(t("user-created"));
    } catch (err) {
      console.error(err);
      toast.error(t("user-create-error"));
    }
  };

  const patchUser = async (user: User, changes: AdminUserUpdate) => {
    try {
      await AdminService.updateUser(user.id, changes);
      await loadUsers();
    } catch (err) {
      console.error(err);
      toast.error(t("user-update-error"));
    }
  };

  const scheduleDeletion = async () => {
    if (!userToDelete) return;
    try {
      await AdminService.scheduleUserDeletion(userToDelete.id);
      await loadUsers();
      toast.success(t("delete-dialog.scheduled"));
    } catch (err) {
      console.error(err);
      toast.error(t("user-delete-error"));
    } finally {
      setUserToDelete(null);
    }
  };

  const cancelDeletion = async (user: User) => {
    try {
      await AdminService.cancelUserDeletion(user.id);
      await loadUsers();
      toast.success(t("deletion-canceled"));
    } catch (err) {
      console.error(err);
      toast.error(t("user-update-error"));
    }
  };

  const resetUserPassword = async () => {
    if (!userToReset || !resetPassword) return;
    try {
      await AdminService.resetUserPassword(userToReset.id, resetPassword);
      await loadUsers();
      toast.success(t("password-reset-success"));
      setUserToReset(null);
      setResetPassword("");
    } catch (err) {
      console.error(err);
      toast.error(t("password-reset-error"));
    }
  };

  const resetUserTotp = async () => {
    if (!userToResetTotp) return;
    try {
      await AdminService.resetUserTotp(userToResetTotp.id);
      await loadUsers();
      toast.success(t("totp-reset-success"));
      setUserToResetTotp(null);
    } catch (err) {
      console.error(err);
      toast.error(t("totp-reset-error"));
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    try {
      const updated = await AdminService.updateSettings(settings);
      setSettings(updated);
      try {
        await refreshConfig();
      } catch (configError) {
        console.error(configError);
      }
      toast.success(t("settings-saved"));
    } catch (err) {
      console.error(err);
      toast.error(t("settings-error"));
    }
  };

  return (
    <>
      <Tabs
        defaultValue="users"
        orientation="vertical"
        className="w-screen h-screen flex flex-col bg-background overflow-hidden"
      >
        <SessionExpiryBanner />

        {/* Header bar */}
        <div className="shrink-0 h-14 border-b flex items-center gap-3 px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={closeAdmin}
            aria-label={t("back")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
        </div>

        {/* Body: left nav + scrollable content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left nav rail */}
          <div className="w-52 shrink-0 border-r p-3 flex flex-col gap-1">
            <TabsList className="flex flex-col h-auto w-full items-stretch gap-1 bg-transparent p-0">
              <TabsTrigger
                value="users"
                className="justify-start data-[state=active]:bg-muted"
              >
                {t("users-tab")}
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                className="justify-start data-[state=active]:bg-muted"
              >
                {t("settings-tab")}
              </TabsTrigger>
              <TabsTrigger
                value="features"
                className="justify-start data-[state=active]:bg-muted"
              >
                {t("features-tab")}
              </TabsTrigger>
              <TabsTrigger
                value="backups"
                className="justify-start data-[state=active]:bg-muted"
              >
                {t("backups-tab")}
              </TabsTrigger>
              <TabsTrigger
                value="relation-types"
                className="justify-start data-[state=active]:bg-muted"
              >
                {t("relation-types-tab")}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-auto p-6">
            <TabsContent value="users" className="mt-0 space-y-4">
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("col-username")}</TableHead>
                      <TableHead>{t("col-provider")}</TableHead>
                      <TableHead className="text-center">
                        {t("col-admin")}
                      </TableHead>
                      <TableHead className="text-center">
                        {t("col-active")}
                      </TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => {
                      const pending = !!u.deletion_scheduled_for;
                      const isSelf = u.id === currentUser?.id;
                      return (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {u.username}
                              {pending && (
                                <Badge variant="destructive">
                                  {t("pending-deletion", {
                                    date: formatDate(
                                      u.deletion_scheduled_for ?? null,
                                    ),
                                  })}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {u.auth_provider}
                          </TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={u.is_admin}
                              disabled={isSelf || pending}
                              onCheckedChange={(v) =>
                                patchUser(u, { is_admin: v })
                              }
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Switch
                              checked={u.is_active}
                              disabled={isSelf || pending}
                              onCheckedChange={(v) =>
                                patchUser(u, { is_active: v })
                              }
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            {pending ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                title={t("cancel-deletion")}
                                onClick={() => cancelDeletion(u)}
                              >
                                <Undo2 className="h-4 w-4" />
                              </Button>
                            ) : (
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title={
                                    u.auth_provider === "local"
                                      ? t("reset-password")
                                      : t("reset-password-unavailable")
                                  }
                                  aria-label={
                                    u.auth_provider === "local"
                                      ? t("reset-password")
                                      : t("reset-password-unavailable")
                                  }
                                  disabled={u.auth_provider !== "local"}
                                  onClick={() => setUserToReset(u)}
                                >
                                  <KeyRound className="h-4 w-4" />
                                </Button>
                                {u.totp_enabled && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title={t("reset-totp")}
                                    aria-label={t("reset-totp")}
                                    onClick={() => setUserToResetTotp(u)}
                                  >
                                    <ShieldOff className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title={t("delete-user")}
                                  aria-label={t("delete-user")}
                                  disabled={isSelf}
                                  onClick={() => setUserToDelete(u)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end border-t pt-4">
                <div className="space-y-1">
                  <FieldLabel htmlFor="nu-username">
                    {t("col-username")}
                  </FieldLabel>
                  <Input
                    id="nu-username"
                    value={newUser.username}
                    onChange={(e) =>
                      setNewUser({ ...newUser, username: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel htmlFor="nu-password">
                    {t("new-password")}
                  </FieldLabel>
                  <Input
                    id="nu-password"
                    type="password"
                    value={newUser.password}
                    onChange={(e) =>
                      setNewUser({ ...newUser, password: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel htmlFor="nu-email">{t("email")}</FieldLabel>
                  <Input
                    id="nu-email"
                    type="email"
                    value={newUser.email}
                    onChange={(e) =>
                      setNewUser({ ...newUser, email: e.target.value })
                    }
                  />
                </div>
                <Button
                  onClick={handleCreateUser}
                  disabled={!newUser.username || !newUser.password}
                >
                  <Plus className="h-4 w-4" />
                  {t("add-user")}
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="settings" className="mt-0 space-y-4">
              {settings && (
                <>
                  <div className="space-y-2">
                    <FieldLabel htmlFor="instance-name">
                      {t("instance-name")}
                    </FieldLabel>
                    <Input
                      id="instance-name"
                      value={settings.instance_name}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          instance_name: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel htmlFor="default-language">
                      {t("default-language")}
                    </FieldLabel>
                    <Input
                      id="default-language"
                      value={settings.default_language}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          default_language: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <FieldLabel htmlFor="deletion-grace">
                      {t("deletion-grace-period")}
                    </FieldLabel>
                    <Input
                      id="deletion-grace"
                      type="number"
                      min={0}
                      value={settings.deletion_grace_period_days}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          deletion_grace_period_days: Math.max(
                            0,
                            Number(e.target.value),
                          ),
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("deletion-grace-period-hint")}
                    </p>
                  </div>
                  <div className="space-y-3 border-t pt-4">
                    <div>
                      <p className="font-medium text-sm">{t("upload-limits")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("upload-limits-hint")}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="space-y-2">
                        <FieldLabel htmlFor="max-image-upload">
                          {t("max-image-upload")}
                        </FieldLabel>
                        <Input
                          id="max-image-upload"
                          type="number"
                          min={1}
                          max={100}
                          value={settings.max_image_upload_mb}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              max_image_upload_mb: Math.min(
                                100,
                                Math.max(1, Number(e.target.value)),
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <FieldLabel htmlFor="max-document-upload">
                          {t("max-document-upload")}
                        </FieldLabel>
                        <Input
                          id="max-document-upload"
                          type="number"
                          min={1}
                          max={500}
                          value={settings.max_document_upload_mb}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              max_document_upload_mb: Math.min(
                                500,
                                Math.max(1, Number(e.target.value)),
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <FieldLabel htmlFor="max-image-dimension">
                          {t("max-image-dimension")}
                        </FieldLabel>
                        <Input
                          id="max-image-dimension"
                          type="number"
                          min={256}
                          max={16384}
                          step={256}
                          value={settings.max_image_dimension}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              max_image_dimension: Math.min(
                                16384,
                                Math.max(256, Number(e.target.value)),
                              ),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3 border-t pt-4">
                    <div>
                      <p className="font-medium text-sm">
                        {t("storage-quotas")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("storage-quotas-hint")}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="space-y-2">
                        <FieldLabel htmlFor="default-tree-quota">
                          {t("default-tree-quota")}
                        </FieldLabel>
                        <Input
                          id="default-tree-quota"
                          type="number"
                          min={0}
                          value={settings.default_tree_quota_mb}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              default_tree_quota_mb: Math.max(
                                0,
                                Number(e.target.value),
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <FieldLabel htmlFor="default-media-quota">
                          {t("default-media-quota")}
                        </FieldLabel>
                        <Input
                          id="default-media-quota"
                          type="number"
                          min={0}
                          value={settings.default_media_quota_mb}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              default_media_quota_mb: Math.max(
                                0,
                                Number(e.target.value),
                              ),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <FieldLabel htmlFor="default-total-quota">
                          {t("default-total-quota")}
                        </FieldLabel>
                        <Input
                          id="default-total-quota"
                          type="number"
                          min={0}
                          value={settings.default_total_quota_mb}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              default_total_quota_mb: Math.max(
                                0,
                                Number(e.target.value),
                              ),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium text-sm">
                        {t("self-registration")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("self-registration-hint")}
                      </p>
                    </div>
                    <Switch
                      checked={settings.allow_self_registration}
                      onCheckedChange={(v) =>
                        setSettings({ ...settings, allow_self_registration: v })
                      }
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={saveSettings}>{t("save-settings")}</Button>
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="features" className="mt-0">
              <FeatureFlagsPanel users={users} />
            </TabsContent>

            <TabsContent value="backups" className="mt-0">
              <BackupPanel
                settings={settings}
                onSettingsChange={setSettings}
                onSaveSettings={saveSettings}
              />
            </TabsContent>

            <TabsContent value="relation-types" className="mt-0">
              <RelationTypesPanel />
            </TabsContent>
          </div>
        </div>
      </Tabs>

      <ConfirmDeleteDialog
        open={!!userToDelete}
        onOpenChange={(open) => !open && setUserToDelete(null)}
        onConfirm={scheduleDeletion}
        title={t("delete-dialog.title")}
        description={t("delete-dialog.description", {
          username: userToDelete?.username ?? "",
          days: settings?.deletion_grace_period_days ?? 7,
        })}
        cancelText={t("delete-dialog.cancel")}
        confirmText={t("delete-dialog.delete")}
      />

      <Dialog
        open={!!userToReset}
        onOpenChange={(open) => {
          if (!open) {
            setUserToReset(null);
            setResetPassword("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("reset-dialog.title")}</DialogTitle>
            <DialogDescription>
              {t("reset-dialog.description", {
                username: userToReset?.username ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <FieldLabel htmlFor="reset-password">
              {t("reset-dialog.password")}
            </FieldLabel>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setUserToReset(null);
                setResetPassword("");
              }}
            >
              {t("reset-dialog.cancel")}
            </Button>
            <Button onClick={resetUserPassword} disabled={!resetPassword}>
              {t("reset-dialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDeleteDialog
        open={!!userToResetTotp}
        onOpenChange={(open) => !open && setUserToResetTotp(null)}
        onConfirm={resetUserTotp}
        title={t("totp-reset-dialog.title")}
        description={t("totp-reset-dialog.description", {
          username: userToResetTotp?.username ?? "",
        })}
        cancelText={t("totp-reset-dialog.cancel")}
        confirmText={t("totp-reset-dialog.confirm")}
      />
    </>
  );
};
