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
import { KeyRound, LogOut, Shield, Trash2, UserIcon } from "lucide-react";
import { useAuthStore } from "@/hooks/useAuthStore";
import { ChangePasswordDialog } from "@/components/auth/ChangePasswordDialog";
import { DeleteAccountDialog } from "@/components/auth/DeleteAccountDialog";
import { AdminDialog } from "@/components/admin/AdminDialog";
import { useTranslation } from "react-i18next";

export const UserMenu = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.user-menu" });
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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
          {user.is_admin && (
            <DropdownMenuItem onClick={() => setAdminOpen(true)}>
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
      {user.is_admin && (
        <AdminDialog isOpen={adminOpen} onClose={() => setAdminOpen(false)} />
      )}
      <DeleteAccountDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  );
};
