import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  KeyRound,
  LogOut,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserIcon,
} from "lucide-react";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useAdminViewStore } from "@/hooks/useAdminViewStore";
import { ChangePasswordDialog } from "@/components/auth/ChangePasswordDialog";
import { DeleteAccountDialog } from "@/components/auth/DeleteAccountDialog";
import { TabSettingsDialog } from "@/components/auth/TabSettingsDialog";
import { TwoFactorDialog } from "@/components/auth/TwoFactorDialog";
import { useTranslation } from "react-i18next";

export const UserMenu = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.user-menu" });
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const openAdmin = useAdminViewStore((s) => s.openAdmin);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tabSettingsOpen, setTabSettingsOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
          >
            <UserIcon className="h-4 w-4" />
            <span className="truncate">{user.username}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="truncate">
            {user.full_name || user.username}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {user.auth_provider === "local" && (
            <DropdownMenuItem onClick={() => setPasswordOpen(true)}>
              <KeyRound className="h-4 w-4" />
              {t("change-password")}
            </DropdownMenuItem>
          )}
          {user.auth_provider === "local" && (
            <DropdownMenuItem onClick={() => setTwoFactorOpen(true)}>
              <ShieldCheck className="h-4 w-4" />
              {t("two-factor")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => setTabSettingsOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" />
            {t("customize-tabs")}
          </DropdownMenuItem>
          {user.is_admin && (
            <DropdownMenuItem onClick={() => openAdmin()}>
              <Shield className="h-4 w-4" />
              {t("admin")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            {t("delete-account")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout}>
            <LogOut className="h-4 w-4" />
            {t("logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangePasswordDialog
        isOpen={passwordOpen}
        onClose={() => setPasswordOpen(false)}
      />
      <TwoFactorDialog
        isOpen={twoFactorOpen}
        onClose={() => setTwoFactorOpen(false)}
      />
      <TabSettingsDialog
        isOpen={tabSettingsOpen}
        onClose={() => setTabSettingsOpen(false)}
      />
      <DeleteAccountDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  );
};
