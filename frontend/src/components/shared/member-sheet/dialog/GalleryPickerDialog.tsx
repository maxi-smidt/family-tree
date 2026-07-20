import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { GalleryImage } from "@/types/gallery";
import { useTranslation } from "react-i18next";

type Props = {
  isOpen: boolean;
  images: GalleryImage[];
  onSelect: (image: GalleryImage) => void;
  onClose: () => void;
};

export const GalleryPickerDialog = ({
  isOpen,
  images,
  onSelect,
  onClose,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "sheet.edit-mode",
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("avatar-gallery-picker-title")}</DialogTitle>
          <DialogDescription>
            {t("avatar-gallery-picker-description")}
          </DialogDescription>
        </DialogHeader>
        {images.length > 0 ? (
          <div className="grid grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto">
            {images.map((image) => (
              <button
                key={image.id}
                type="button"
                aria-label={image.title || t("avatar-menu-choose-gallery")}
                className="rounded-md overflow-hidden transition-shadow hover:ring-2 hover:ring-primary"
                onClick={() => onSelect(image)}
              >
                <AuthenticatedImage
                  src={image.imageData}
                  alt={image.title || ""}
                  className="w-full h-20 object-cover"
                />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t("photos-empty")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
};
