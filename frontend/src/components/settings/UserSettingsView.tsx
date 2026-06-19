import { useState, useEffect } from "react";
import {
  ArrowLeft,
  HardDrive,
  LayoutDashboard,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldLabel } from "@/components/ui/field";
import { SessionExpiryBanner } from "@/components/layout/SessionExpiryBanner";
import { TabSettingsDialog } from "@/components/auth/TabSettingsDialog";
import { TwoFactorDialog } from "@/components/auth/TwoFactorDialog";
import { DeleteAccountDialog } from "@/components/auth/DeleteAccountDialog";
import { useUserSettingsViewStore } from "@/hooks/useUserSettingsViewStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { UserPreferencesService } from "@/services/UserPreferencesService";
import type { ImageStorageMode } from "@/types/user";
import { toast } from "sonner";

const STORAGE_MODE_ORDER: ImageStorageMode[] = [
  "compressed",
  "both",
  "original",
];

function allowedModes(max: ImageStorageMode): ImageStorageMode[] {
  const idx = STORAGE_MODE_ORDER.indexOf(max);
  return idx >= 0 ? STORAGE_MODE_ORDER.slice(0, idx + 1) : ["compressed"];
}

export const UserSettingsView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "user-settings" });
  const closeSettings = useUserSettingsViewStore((s) => s.closeSettings);
  const user = useAuthStore((s) => s.user);
  const refreshMe = useAuthStore((s) => s.refreshMe);

  const effectiveMode: ImageStorageMode =
    user?.image_storage_mode ?? "compressed";
  const maxMode: ImageStorageMode =
    user?.image_storage_mode_max ?? "compressed";
  const modes = allowedModes(maxMode);

  const [selectedMode, setSelectedMode] =
    useState<ImageStorageMode>(effectiveMode);
  const [saving, setSaving] = useState(false);
  const [tabSettingsOpen, setTabSettingsOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    setSelectedMode(effectiveMode);
  }, [effectiveMode]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await UserPreferencesService.updateUserSettings({
        image_storage_mode: selectedMode,
      });
      await refreshMe();
      toast.success(t("toast-saved"));
    } catch {
      toast.error(t("toast-error"));
    } finally {
      setSaving(false);
    }
  };

  const isLocal = user?.auth_provider === "local";
  const totpEnabled = user?.totp_enabled ?? false;

  return (
    <>
      <div className="flex flex-col h-screen bg-background">
        <SessionExpiryBanner />
        <div className="flex items-center gap-3 px-6 py-4 border-b">
          <Button variant="ghost" size="icon" onClick={closeSettings}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-lg space-y-6">
            {/* Gallery image storage */}
            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <HardDrive className="h-4 w-4" />
                {t("image-storage.section")}
              </div>
              <div className="space-y-1.5">
                <FieldLabel>{t("image-storage.label")}</FieldLabel>
                <Select
                  value={selectedMode}
                  onValueChange={(v) => setSelectedMode(v as ImageStorageMode)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modes.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {t(`image-storage.${mode}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("image-storage.hint")}
                </p>
              </div>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || selectedMode === effectiveMode}
              >
                {t("save")}
              </Button>
            </div>

            {/* Tab customization */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <LayoutDashboard className="h-4 w-4" />
                {t("tabs.section")}
              </div>
              <p className="text-xs text-muted-foreground">{t("tabs.hint")}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTabSettingsOpen(true)}
              >
                {t("tabs.button")}
              </Button>
            </div>

            {/* Two-factor authentication (local accounts only) */}
            {isLocal && (
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4" />
                  {t("two-factor.section")}
                </div>
                <p className="text-xs text-muted-foreground">
                  {totpEnabled
                    ? t("two-factor.status-enabled")
                    : t("two-factor.status-disabled")}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTwoFactorOpen(true)}
                >
                  {t("two-factor.button")}
                </Button>
              </div>
            )}

            {/* Delete account */}
            <div className="rounded-lg border border-destructive/40 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <Trash2 className="h-4 w-4" />
                {t("delete-account.section")}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("delete-account.hint")}
              </p>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setDeleteOpen(true)}
              >
                {t("delete-account.button")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <TabSettingsDialog
        isOpen={tabSettingsOpen}
        onClose={() => setTabSettingsOpen(false)}
      />
      <TwoFactorDialog
        isOpen={twoFactorOpen}
        onClose={() => setTwoFactorOpen(false)}
      />
      <DeleteAccountDialog
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
      />
    </>
  );
};
