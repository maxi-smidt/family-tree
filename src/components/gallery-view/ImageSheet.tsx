import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { GalleryImage } from "@/types/gallery";
import { useFamilyStore } from "@/hooks/useFamilyStore";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MultiSelect } from "@/components/ui/multi-select";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { useTranslation } from "react-i18next";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  image: GalleryImage;
};

export const ImageSheet = ({ isOpen, onClose, image }: Props) => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "gallery-view.image-sheet",
  });
  const { members, updateGalleryImage } = useFamilyStore();
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

  const handleDateChange = (date: Date | undefined) => {
    if (date) {
      setFormData({ ...formData, createdAt: date.toISOString() });
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-[80vw]">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
        </SheetHeader>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <img
              src={image.imageData}
              alt={image.title || "Gallery Image"}
              className="w-full h-auto object-contain"
            />
          </div>
          <div>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                  {t("title-field")}
                </FieldLabel>
                <Input
                  placeholder={t("title-placeholder")}
                  value={formData.title || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, title: e.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                  {t("description-field")}
                </FieldLabel>
                <Textarea
                  placeholder={t("description-placeholder")}
                  value={formData.description || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                  {t("date-field")}
                </FieldLabel>
                <DatePicker
                  value={new Date(formData.createdAt || new Date())}
                  onChange={handleDateChange}
                />
              </Field>
              <Field>
                <FieldLabel className="text-[12px] font-semibold text-muted-foreground uppercase">
                  {t("members-field")}
                </FieldLabel>
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
              <Button onClick={handleSave}>{t("save")}</Button>
            </FieldGroup>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
