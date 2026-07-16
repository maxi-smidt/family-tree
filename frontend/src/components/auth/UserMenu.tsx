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
  GraduationCap,
  KeyRound,
  LogOut,
  Settings,
  Shield,
} from "lucide-react";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useAdminViewStore } from "@/hooks/useAdminViewStore";
import { useUserSettingsViewStore } from "@/hooks/useUserSettingsViewStore";
import { useTutorialStore } from "@/hooks/useTutorialStore";
import { ChangePasswordDialog } from "@/components/auth/ChangePasswordDialog";
import { AccountAvatar } from "@/components/auth/AccountAvatar";
import { useTranslation } from "react-i18next";

export const UserMenu = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.user-menu" });
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const openAdmin = useAdminViewStore((s) => s.openAdmin);
  const openSettings = useUserSettingsViewStore((s) => s.openSettings);
  const features = useAuthStore((s) => s.features);
  const tutorialEnabled = features.includes("onboarding_tour");
  const startTutorial = useTutorialStore((s) => s.start);
  const [passwordOpen, setPasswordOpen] = useState(false);

  if (!user) return null;

  const profileName =
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    user.full_name ||
    user.username;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
          >
            <AccountAvatar user={user} className="h-5 w-5 text-[9px]" />
            <span className="truncate">{user.username}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="truncate">
            {profileName}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {user.auth_provider === "local" && (
            <DropdownMenuItem onClick={() => setPasswordOpen(true)}>
              <KeyRound className="h-4 w-4" />
              {t("change-password")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => openSettings()}>
            <Settings className="h-4 w-4" />
            {t("settings")}
          </DropdownMenuItem>
          {tutorialEnabled && (
            <DropdownMenuItem onClick={() => startTutorial()}>
              <GraduationCap className="h-4 w-4" />
              {t("show-tutorial")}
            </DropdownMenuItem>
          )}
          {user.is_admin && (
            <DropdownMenuItem onClick={() => openAdmin()}>
              <Shield className="h-4 w-4" />
              {t("admin")}
            </DropdownMenuItem>
          )}
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
    </>
  );
};
