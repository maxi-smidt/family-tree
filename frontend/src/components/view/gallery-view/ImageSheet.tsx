import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AuthenticatedImage } from "@/components/ui/AuthenticatedImage";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { GalleryImage } from "@/types/gallery";
import { useMemberStore } from "@/hooks/useMemberStore";
import { useGalleryStore } from "@/hooks/useGalleryStore";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MultiSelect } from "@/components/ui/multi-select";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  image: GalleryImage;
};

export const ImageSheet = ({ isOpen, onClose, image }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "gallery-view.image-sheet",
  });
  const { members } = useMemberStore();
  const { updateGalleryImage, deleteGalleryImage } = useGalleryStore();
  const [formData, setFormData] = useState<Partial<GalleryImage>>(image);

  useEffect(() => {
    setFormData(image);
  }, [image]);

  const memberOptions = useMemo(
    () =>
      members.map((member) => ({
        value: member.id,
        label: `${member.firstName} ${member.lastName}`,
      })),
    [members],
  );

  const handleSave = () => {
    updateGalleryImage(image.id, formData)
      .then(() => {
        toast.success(t("toast-success"));
        onClose();
      })
      .catch(() => toast.error(t("toast-error")));
  };

  const handleDelete = () => {
    deleteGalleryImage(image.id)
      .then(() => {
        toast.success(t("toast-delete-success"));
        onClose();
      })
      .catch(() => toast.error(t("toast-delete-error")));
  };

  const handleDateChange = (date: Date | undefined) => {
    if (date) {
      setFormData({ ...formData, createdAt: date.toISOString() });
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-[80vw] flex flex-col p-4">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-8 overflow-hidden min-h-0">
          <div className="flex items-start justify-center min-h-0">
            <AuthenticatedImage
              src={image.imageData}
              alt={image.title || "Gallery Image"}
              className="max-w-full max-h-full object-contain rounded-md"
            />
          </div>
          <div className="flex flex-col min-h-0">
            <FieldGroup className="gap-4 flex-1 overflow-y-auto px-1">
              <Field>
                <FieldLabel>{t("title-field")}</FieldLabel>
                <Input
                  placeholder={t("title-placeholder")}
                  value={formData.title || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>{t("description-field")}</FieldLabel>
                <Textarea
                  placeholder={t("description-placeholder")}
                  value={formData.description || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel>{t("date-field")}</FieldLabel>
                <DatePicker
                  value={new Date(formData.createdAt || new Date())}
                  onChange={handleDateChange}
                />
              </Field>
              <Field>
                <FieldLabel>{t("members-field")}</FieldLabel>
                <MultiSelect
                  options={memberOptions}
                  defaultValue={formData.linkedMemberIds || []}
                  onValueChange={(selected) =>
                    setFormData({ ...formData, linkedMemberIds: selected })
                  }
                  placeholder={t("members-placeholder")}
                  variant="secondary"
                  animation={0}
                  maxCount={25}
                  popoverSide="left"
                  hideSelectAll={true}
                />
              </Field>
            </FieldGroup>
            <div className="flex justify-end gap-2 mt-4 shrink-0">
              <Button onClick={handleSave}>{t("save")}</Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">{t("delete")}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("delete-confirm-title")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("delete-confirm-description")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>
                      {t("delete-confirm-cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={handleDelete}
                    >
                      {t("delete-confirm-confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
