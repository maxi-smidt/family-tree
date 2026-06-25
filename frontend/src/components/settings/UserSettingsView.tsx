import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  HardDrive,
  LayoutDashboard,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldLabel } from "@/components/ui/field";
import { SessionExpiryBanner } from "@/components/layout/SessionExpiryBanner";
import { TabSettingsPanel } from "@/components/settings/TabSettingsPanel";
import { TwoFactorPanel } from "@/components/settings/TwoFactorPanel";
import { DeleteAccountPanel } from "@/components/settings/DeleteAccountPanel";
import { useUserSettingsViewStore } from "@/hooks/useUserSettingsViewStore";
import { useAuthStore } from "@/hooks/useAuthStore";
import { UserPreferencesService } from "@/services/UserPreferencesService";
import type { ImageStorageMode } from "@/types/user";
import { toast } from "sonner";

export const UserSettingsView = () => {
  const { t } = useTranslation(undefined, { keyPrefix: "user-settings" });
  const closeSettings = useUserSettingsViewStore((s) => s.closeSettings);
  const user = useAuthStore((s) => s.user);
  const config = useAuthStore((s) => s.config);
  const refreshMe = useAuthStore((s) => s.refreshMe);

  const effectiveMode: ImageStorageMode =
    user?.image_storage_mode ?? "compressed";
  const modes: ImageStorageMode[] = user?.image_storage_allowed_modes ?? [
    "compressed",
  ];

  const [selectedMode, setSelectedMode] =
    useState<ImageStorageMode>(effectiveMode);
  const [saving, setSaving] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

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

  const handleToggleMonitoring = async (checked: boolean) => {
    setSavingPrivacy(true);
    try {
      await UserPreferencesService.updateUserSettings({
        // Preserve the existing storage mode; only change error_monitoring.
        image_storage_mode: user?.image_storage_mode ?? null,
        error_monitoring: checked,
      });
      await refreshMe();
      toast.success(t("privacy.toast-saved"));
    } catch {
      toast.error(t("toast-error"));
    } finally {
      setSavingPrivacy(false);
    }
  };

  const isLocal = user?.auth_provider === "local";
  const monitoringEnabled = config?.sentry_dsn != null;

  return (
    <Tabs
      defaultValue="gallery"
      orientation="vertical"
      className="w-screen h-screen flex flex-col bg-background overflow-hidden"
    >
      <SessionExpiryBanner />

      {/* Header bar */}
      <div className="shrink-0 h-14 border-b flex items-center gap-3 px-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={closeSettings}
          aria-label={t("back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold">{t("title")}</h1>
      </div>

      {/* Body: left nav + scrollable content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left nav rail — width follows content */}
        <div className="shrink-0 border-r p-3 flex flex-col gap-1">
          <TabsList className="flex flex-col h-auto w-full items-stretch gap-1 bg-transparent p-0">
            <TabsTrigger
              value="gallery"
              className="justify-start data-[state=active]:bg-muted"
            >
              <HardDrive className="h-4 w-4 mr-2" />
              {t("image-storage.section")}
            </TabsTrigger>
            <TabsTrigger
              value="tabs"
              className="justify-start data-[state=active]:bg-muted"
            >
              <LayoutDashboard className="h-4 w-4 mr-2" />
              {t("tabs.section")}
            </TabsTrigger>
            {isLocal && (
              <TabsTrigger
                value="two-factor"
                className="justify-start data-[state=active]:bg-muted"
              >
                <ShieldCheck className="h-4 w-4 mr-2" />
                {t("two-factor.section")}
              </TabsTrigger>
            )}
            {monitoringEnabled && (
              <TabsTrigger
                value="privacy"
                className="justify-start data-[state=active]:bg-muted"
              >
                <ShieldAlert className="h-4 w-4 mr-2" />
                {t("privacy.section")}
              </TabsTrigger>
            )}
            <TabsTrigger
              value="account"
              className="justify-start data-[state=active]:bg-muted text-destructive data-[state=active]:text-destructive"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t("delete-account.section")}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto p-6">
          <TabsContent value="gallery" className="mt-0 max-w-md space-y-4">
            <div>
              <p className="font-medium text-sm">{t("image-storage.label")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("image-storage.hint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <FieldLabel>{t("image-storage.label")}</FieldLabel>
              <Select
                value={selectedMode}
                onValueChange={(v) => setSelectedMode(v as ImageStorageMode)}
              >
                <SelectTrigger className="w-64">
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
            </div>
            <div className="flex justify-end max-w-64">
              <Button
                onClick={handleSave}
                disabled={saving || selectedMode === effectiveMode}
              >
                {t("save")}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="tabs" className="mt-0">
            <TabSettingsPanel />
          </TabsContent>

          <TabsContent value="two-factor" className="mt-0">
            <TwoFactorPanel />
          </TabsContent>

          <TabsContent value="privacy" className="mt-0 max-w-md space-y-4">
            <div>
              <p className="font-medium text-sm">{t("privacy.section")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("privacy.hint")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="error-monitoring-toggle"
                checked={user?.error_monitoring ?? false}
                onCheckedChange={handleToggleMonitoring}
                disabled={savingPrivacy}
              />
              <label
                htmlFor="error-monitoring-toggle"
                className="text-sm cursor-pointer"
              >
                {t("privacy.label")}
              </label>
            </div>
          </TabsContent>

          <TabsContent value="account" className="mt-0">
            <DeleteAccountPanel />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
};
