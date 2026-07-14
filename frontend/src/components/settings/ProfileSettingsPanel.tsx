import { ChangeEvent, useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AccountAvatar } from "@/components/auth/AccountAvatar";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/hooks/useAuthStore";
import { getQuotaBucket } from "@/lib/quotaError";
import { ApiError } from "@/services/api";

export function ProfileSettingsPanel() {
  const { t } = useTranslation(undefined, { keyPrefix: "auth.profile" });
  const user = useAuthStore((state) => state.user);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const uploadProfileImage = useAuthStore((state) => state.uploadProfileImage);
  const removeProfileImage = useAuthStore((state) => state.removeProfileImage);
  const operation = useAuthStore((state) => state.accountOperation);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");

  useEffect(() => {
    setFirstName(user?.first_name ?? "");
    setLastName(user?.last_name ?? "");
  }, [user?.first_name, user?.last_name]);

  if (!user) return null;

  const savingProfile = operation === "saving-profile";
  const uploadingImage = operation === "uploading-profile-image";
  const removingImage = operation === "removing-profile-image";
  const namesChanged =
    firstName !== (user.first_name ?? "") ||
    lastName !== (user.last_name ?? "");

  const handleSave = async () => {
    try {
      await updateProfile(firstName, lastName);
      toast.success(t("save-success"));
    } catch {
      toast.error(t("save-error"));
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await uploadProfileImage(file);
      toast.success(t("upload-success"));
    } catch (error) {
      if (error instanceof ApiError && error.status === 413) {
        const bucket = getQuotaBucket(error.message);
        toast.error(
          bucket ? t("toast-error-quota-media") : t("upload-too-large"),
        );
      } else if (error instanceof ApiError && error.status === 400) {
        toast.error(t("upload-unsupported"));
      } else {
        toast.error(t("upload-error"));
      }
    }
  };

  const handleRemoveImage = async () => {
    try {
      await removeProfileImage();
      toast.success(t("remove-success"));
    } catch {
      toast.error(t("remove-error"));
    }
  };

  return (
    <div className="max-w-md space-y-6">
      <div>
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("description")}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <AccountAvatar user={user} className="h-20 w-20 text-2xl" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleFileChange(event)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploadingImage || removingImage}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus />
            {user.profile_image_url ? t("replace-image") : t("upload-image")}
          </Button>
          {user.profile_image_url && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={uploadingImage || removingImage}
              onClick={() => void handleRemoveImage()}
            >
              <Trash2 />
              {t("remove-image")}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <FieldLabel htmlFor="profile-first-name">
            {t("first-name")}
          </FieldLabel>
          <Input
            id="profile-first-name"
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <FieldLabel htmlFor="profile-last-name">{t("last-name")}</FieldLabel>
          <Input
            id="profile-last-name"
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />
        </div>
      </div>

      <Button
        disabled={savingProfile || !namesChanged}
        onClick={() => void handleSave()}
      >
        {t("save")}
      </Button>
    </div>
  );
}
