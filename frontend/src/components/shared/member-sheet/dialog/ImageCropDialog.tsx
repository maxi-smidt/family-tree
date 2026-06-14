import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ReactCrop, { Crop, PixelCrop } from "react-image-crop";
import { useEffect, useRef, useState } from "react";
import { getCroppedImg } from "@/utils/canvasUtils";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type Props = {
  imageData: string | null;
  isOpen: boolean;
  onConfirm: (imageData: string) => void;
  onCancel: () => void;
};

export const ImageCropDialog = ({
  imageData,
  isOpen,
  onConfirm,
  onCancel,
}: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "dialog.image-crop",
  });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCrop(undefined);
      setCompletedCrop(undefined);
    }
  }, [isOpen]);

  const handleConfirm = () => {
    if (!imgRef.current || !completedCrop) return;
    if (completedCrop.width === 0 || completedCrop.height === 0) return;

    try {
      setIsLoading(true);
      const croppedImage = getCroppedImg(imgRef.current, completedCrop, 300);
      onConfirm(croppedImage);
    } catch (e) {
      console.error(e);
      toast.error(t("crop-error"));
    } finally {
      setIsLoading(false);
    }
  };

  if (!imageData) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-center max-h-[60vh] overflow-auto">
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
            circularCrop
            aspect={1}
            keepSelection
          >
            <img
              ref={imgRef}
              src={imageData}
              alt="Crop"
              className="max-w-full"
            />
          </ReactCrop>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" onClick={onCancel}>
              {t("cancel")}
            </Button>
          </DialogClose>
          <Button
            variant="default"
            size="sm"
            onClick={handleConfirm}
            disabled={!crop || isLoading}
          >
            {isLoading && <Spinner />}
            {t("crop")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
