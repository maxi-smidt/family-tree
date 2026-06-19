import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
          {/* Left nav rail */}
          <div className="w-52 shrink-0 border-r p-3 flex flex-col gap-1">
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
            {/* Gallery image storage */}
            <TabsContent value="gallery" className="mt-0 max-w-md space-y-4">
              <div>
                <p className="font-medium text-sm">
                  {t("image-storage.label")}
                </p>
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
              <div className="flex justify-end">
                <Button
                  onClick={handleSave}
                  disabled={saving || selectedMode === effectiveMode}
                >
                  {t("save")}
                </Button>
              </div>
            </TabsContent>

            {/* Tab layout */}
            <TabsContent value="tabs" className="mt-0 max-w-md space-y-4">
              <div>
                <p className="font-medium text-sm">{t("tabs.section")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("tabs.hint")}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => setTabSettingsOpen(true)}
              >
                {t("tabs.button")}
              </Button>
            </TabsContent>

            {/* Two-factor authentication */}
            <TabsContent value="two-factor" className="mt-0 max-w-md space-y-4">
              <div>
                <p className="font-medium text-sm">{t("two-factor.section")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {totpEnabled
                    ? t("two-factor.status-enabled")
                    : t("two-factor.status-disabled")}
                </p>
              </div>
              <Button variant="outline" onClick={() => setTwoFactorOpen(true)}>
                {t("two-factor.button")}
              </Button>
            </TabsContent>

            {/* Delete account */}
            <TabsContent value="account" className="mt-0 max-w-md space-y-4">
              <div>
                <p className="font-medium text-sm text-destructive">
                  {t("delete-account.section")}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("delete-account.hint")}
                </p>
              </div>
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                {t("delete-account.button")}
              </Button>
            </TabsContent>
          </div>
        </div>
      </Tabs>

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
