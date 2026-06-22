import { ChangeEvent, useRef } from "react";
import { Member } from "@/types/member";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemTitle } from "@/components/ui/item";
import { ImagePlus } from "lucide-react";
import { ApiError } from "@/services/api";
import { getQuotaBucket, quotaToastKey } from "@/lib/quotaError";
import { toast } from "sonner";
import { useAuthStore } from "@/hooks/useAuthStore";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/utils/dateUtils";

type Props = {
  member: Member;
};

export const MemberPhotos = ({ member }: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "sheet.edit-mode" });
  const { galleryImages, addGalleryImage } = useGalleryStore();
  const mediaLimits = useAuthStore((state) => state.config?.media_limits);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const linkedImages = galleryImages.filter((img) =>
    img.linkedMemberIds.includes(member.id),
  );

  const handleUpload = () => fileInputRef.current?.click();

  const uploadFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64String = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;

        if (mediaLimits && width > height) {
          if (width > mediaLimits.stored_image_width) {
            height *= mediaLimits.stored_image_width / width;
            width = mediaLimits.stored_image_width;
          }
        } else if (mediaLimits) {
          if (height > mediaLimits.stored_image_height) {
            width *= mediaLimits.stored_image_height / height;
            height = mediaLimits.stored_image_height;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          toast.error(t("toast-error-photo-upload"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL("image/jpeg", 0.8);

        addGalleryImage({
          imageData: compressed,
          title: formatDateTime(new Date()),
          description: null,
          linkedMemberIds: [member.id],
        })
          .then(() => toast.success(t("toast-success-photo-upload")))
          .catch((err: unknown) => {
            if (err instanceof ApiError && err.status === 413) {
              const bucket = getQuotaBucket(err.message);
              if (bucket) {
                toast.error(t(quotaToastKey(bucket)));
              } else {
                toast.error(t("toast-error-image-too-large"));
              }
            } else if (err instanceof ApiError && err.status === 400) {
              toast.error(t("toast-error-image-unsupported"));
            } else {
              toast.error(t("toast-error-photo-upload"));
            }
          });
      };
      img.onerror = () => toast.error(t("toast-error-photo-upload"));
      img.src = base64String;
    };
    reader.onerror = () => toast.error(t("toast-error-file"));
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    files.forEach(uploadFile);
  };

  return (
    <Item variant="muted">
      <ItemContent>
        <div className="flex items-center justify-between mb-2">
          <ItemTitle>{t("photos-field")}</ItemTitle>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={handleUpload}
          >
            <ImagePlus />
            {t("photos-add")}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
        {linkedImages.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 mt-1">
            {linkedImages.map((image) => (
              <AuthenticatedImage
                key={image.id}
                src={image.imageData}
                alt={image.title || ""}
                className="w-full h-20 object-cover rounded-md"
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("photos-empty")}</p>
        )}
      </ItemContent>
    </Item>
  );
};
