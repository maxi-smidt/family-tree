import { ChangeEvent, useRef, useState } from "react";
import { Member } from "@/types/member";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { GalleryImage } from "@/types/gallery";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Button } from "@/components/ui/button";
import { RECORD_SECTION_IDS, RecordSectionCard } from "./RecordSectionCard";
import { ImagePlus } from "lucide-react";
import { ApiError } from "@/services/api";
import { getQuotaBucket, quotaToastKey } from "@/lib/quotaError";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/utils/dateUtils";
import { ImageSheet } from "@/components/view/gallery-view/ImageSheet";

type Props = {
  member: Member;
};

export const MemberPhotos = ({ member }: Props) => {
  const { t } = useTranslation(undefined, { keyPrefix: "sheet.edit-mode" });
  const { galleryImages, addGalleryImage } = useGalleryStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [faceTagQueue, setFaceTagQueue] = useState<GalleryImage[]>([]);

  const linkedImages = galleryImages.filter((img) =>
    img.linkedMemberIds.includes(member.id),
  );

  const handleUpload = () => fileInputRef.current?.click();

  const uploadFile = async (file: File) => {
    // The file streams to the backend as multipart form-data — it is never read
    // into a base64 data URL here. Resizing/normalization happens server-side.
    try {
      const imageId = await addGalleryImage({
        file,
        title: formatDateTime(new Date()),
        description: null,
        linkedMemberIds: [member.id],
      });
      toast.success(t("toast-success-photo-upload"));
      return imageId;
    } catch (err: unknown) {
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
      return undefined;
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    e.target.value = "";
    const imageIds = await Promise.all(files.map(uploadFile));
    const imagesById = new Map(
      useGalleryStore
        .getState()
        .galleryImages.map((image) => [image.id, image]),
    );
    const uploadedImages = imageIds.flatMap((imageId) => {
      const image = imageId ? imagesById.get(imageId) : undefined;
      return image ? [image] : [];
    });
    setFaceTagQueue((queue) => [...queue, ...uploadedImages]);
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />
      <RecordSectionCard
        sectionId={RECORD_SECTION_IDS.gallery}
        title={t("photos-field")}
        headerActions={
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={handleUpload}
          >
            <ImagePlus />
            {t("photos-add")}
          </Button>
        }
      >
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
      </RecordSectionCard>
      {faceTagQueue[0] && (
        <ImageSheet
          isOpen
          onClose={() => setFaceTagQueue((queue) => queue.slice(1))}
          image={faceTagQueue[0]}
          initialTagMode
        />
      )}
    </>
  );
};
