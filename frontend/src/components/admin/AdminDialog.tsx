import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { FieldLabel } from "@/components/ui/field";
import { Trash2, Plus } from "lucide-react";
import { api } from "@/services/api";
import { User } from "@/types/user";
import { useAuthStore } from "@/hooks/useAuthStore";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

interface Settings {
  allow_self_registration: boolean;
  instance_name: string;
  default_language: string;
}

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export const AdminDialog = ({ isOpen, onClose }: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "admin" });
  const currentUser = useAuthStore((s) => s.user);

  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    email: "",
    is_admin: false,
  });

  const loadUsers = useCallback(async () => {
    setUsers(await api.get<User[]>("/users"));
  }, []);

  const loadSettings = useCallback(async () => {
    setSettings(await api.get<Settings>("/settings"));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadUsers();
    void loadSettings();
  }, [isOpen, loadUsers, loadSettings]);

  const handleCreateUser = async () => {
    try {
      await api.post("/users", {
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

  const patchUser = async (user: User, changes: Partial<User>) => {
    try {
      await api.patch(`/users/${user.id}`, changes);
      await loadUsers();
    } catch (err) {
      console.error(err);
      toast.error(t("user-update-error"));
    }
  };

  const deleteUser = async (user: User) => {
    try {
      await api.del(`/users/${user.id}`);
      await loadUsers();
    } catch (err) {
      console.error(err);
      toast.error(t("user-delete-error"));
    }
  };

  const saveSettings = async () => {
    if (!settings) return;
    try {
      const updated = await api.patch<Settings>("/settings", settings);
      setSettings(updated);
      toast.success(t("settings-saved"));
    } catch (err) {
      console.error(err);
      toast.error(t("settings-error"));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">{t("users-tab")}</TabsTrigger>
            <TabsTrigger value="settings">{t("settings-tab")}</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            <div className="border rounded-lg overflow-hidden max-h-72 overflow-y-auto">
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
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.username}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {u.auth_provider}
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={u.is_admin}
                          disabled={u.id === currentUser?.id}
                          onCheckedChange={(v) => patchUser(u, { is_admin: v })}
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={u.is_active}
                          disabled={u.id === currentUser?.id}
                          onCheckedChange={(v) =>
                            patchUser(u, { is_active: v })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={u.id === currentUser?.id}
                          onClick={() => deleteUser(u)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
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

          <TabsContent value="settings" className="space-y-4">
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
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
